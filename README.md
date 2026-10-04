# 从 Windows 出一份 macOS `.app` —— 可行路径与操作手册

> 适用场景：你手上是 Windows 机器，需要交付一个别人双击就能打开的 macOS 应用。
> 本文所有结论均以 electron-builder / Tauri 官方文档为准，不猜。

---

## 0. 结论先行（30 秒版）

| 问题 | 答案 |
|---|---|
| Windows 上能直接跑 `electron-builder --mac` 出 `.app` 吗？ | **不能。** Windows 宿主只能构建 Windows 目标。 |
| Windows 上能用 Tauri 交叉编译出 `.dmg` 吗？ | **不能。** 官方原话：`.app` 和 `.dmg` 只能在 macOS 上创建，交叉编译尚不可用。 |
| 那怎么办？ | 三条路：① 借一台 Mac（5 分钟出包）② GitHub Actions 的 macOS runner（零 Mac，免费）③ 云 Mac 租赁。 |
| 现在能做什么？ | 工程、打包配置、CI 工作流**已经全部写好**（本目录），Mac 上只剩一条命令。 |

**一句话**：`打包命令` 和 `Mac 机器` 这两个条件必须同时满足，缺的是机器，不是代码。

---

## 1. 硬约束：为什么 Windows 上打不出 `.app`

`.app` 不是单个文件，而是一个 **bundle 目录**，里面装的是 Mach-O 格式的可执行文件和 `Info.plist`。要产出它，缺的不是"打包逻辑"，而是三样 Apple 专属的东西：

1. **Apple 的签名工具链**（`codesign` / `notarytool` / Keychain）。
   electron-builder 官方文档写明：*"macOS code signing only works on macOS. You cannot sign macOS apps on Windows or Linux."* 这是 Apple 的安全设计，任何工具都绕不过去。
2. **`.dmg` 的制作工具**（`hdiutil`），只有 macOS 自带。
3. **`.icns` 图标生成**（`iconutil`）。

Tauri 更绝对：它要调用 macOS SDK 的 `clang` 去编译 Rust 产物，Windows 上根本没有这套交叉编译目标。

所以：**这不是配置问题，是平台边界问题。**

---

## 2. 三条路线对比

| | 路线 A：借 Mac | 路线 B：GitHub Actions | 路线 C：云 Mac |
|---|---|---|---|
| 需要什么 | 任意一台 Mac | 一个 GitHub 账号 | 付费订阅（MacinCloud / MacStadium 等） |
| 成本 | 0 | 公开仓库免费；私有仓库 Free 计划 2000 分钟/月，**macOS 按 10 倍扣**（≈200 macOS 分钟/月，一次构建约 4 分钟） | 按时长计费 |
| 首次到手耗时 | 10 分钟（含装 Node） | 15 分钟（含建仓库） | 30 分钟以上 |
| 后续自动化 | 手动 | **全自动**，推 tag 自动出包并挂 Release | 半自动 |
| 适合 | 手边就有 Mac | **长期方案，推荐** | 临时且必须自己掌控构建机 |

**建议**：如果团队里有人用 Mac，走 A 先把包拿到手验证；同时把本目录推到 GitHub，用 B 做成长期流水线。

---

## 3. 路线 A：在 Mac 上本地打包（最快）

### 3.1 准备（只做一次）

```bash
# 1) 装 Node 20 或更高（推荐用 nvm）
brew install node@20

# 2) 把本工程拷到 Mac 上（U 盘 / 网盘 / git 都行）
cd yitang-daily-qa

# 3) 装依赖（国内网络建议加镜像，见 §11 坑 1）
npm install
```

### 3.2 出包

```bash
npm run icon          # 生成 1024x1024 图标（可跳过，图标已生成）
npm run dist:mac      # 只出当前 Mac 架构的 dmg + zip
# 或者
npm run dist:mac:all  # arm64 + x64 两份都出（推荐给不确定对方机型的场景）
```

产物在 `dist/`：

```
dist/
├── YitangDaily-0.1.0-arm64.dmg      ← 安装包（拖进 Applications）
├── YitangDaily-0.1.0-arm64-mac.zip  ← 免安装绿色包（解压即用）
├── YitangDaily-0.1.0-x64.dmg
├── YitangDaily-0.1.0-x64-mac.zip
├── mac-arm64/YitangDaily.app        ← 真正意义上的 .app
└── mac/YitangDaily.app
```

**dmg 和 zip 选哪个？**
- 给别人装：发 `.dmg`，用户双击 → 拖进 Applications。
- 自己或同事快速用：发 `.zip`，解压就能跑；也是以后做自动更新必须具备的格式。

### 3.3 想在本机先验收 UI（不用等 Mac）

```bash
npm start          # 开发模式直接跑（会打开窗口）
npm run dist:win   # 出个 Windows exe，功能完全一致，可先验收交互
```

---

## 4. 路线 B：GitHub Actions 自动出包（零 Mac，推荐）

工作流文件已经写好：`.github/workflows/build.yml`。

### 4.1 一次性配置

```bash
cd yitang-daily-qa
git init && git add -A && git commit -m "feat: 每日问答桌面版"
gh repo create yitang-daily-qa --private --source=. --push
# 没有 gh 就去 github.com 手动新建仓库，再 git remote add origin ... && git push
```

> **建议设为 public**：公开仓库的标准 runner 分钟数**完全免费且不限量**（含 macOS）。
> 私有仓库会按 10 倍倍率扣减额度（Free 计划约能跑 ~50 次 macOS 构建/月），够用但会担心额度。

### 4.2 出包

两种触发方式：

- **手动**：仓库页面 → `Actions` → 左侧 `build` → `Run workflow`。
- **自动**：打标签推送，会同时创建 Release 并把 dmg 挂上去。
  ```bash
  git tag v0.1.0 && git push origin v0.1.0
  ```

构建完成后：`Actions` → 这次运行 → 底部 `Artifacts` → 下载 `yitang-daily-mac`，解压即得 `.dmg`。

一次构建约 3~5 分钟（首次装依赖会久一点）。

### 4.3 关于 Apple Silicon / Intel

- `runs-on: macos-14` 是 Apple Silicon 机器，`macos-13` 是 Intel。
- **不需要两台 runner**：在任意一台 Mac 上，`npx electron-builder --mac --arm64 --x64` 都会自动下载对应架构的 Electron 二进制并分别出包。本工程的工作流已经这么配了。
- 想要"一个包装两种芯片"：把参数换成 `--universal`，体积约翻倍，一般不必要。

---

## 5. 路线 C：云 Mac 租赁

适合"必须自己掌控构建机、又完全不想用 CI"的情况。

- MacinCloud / MacStadium / AWS EC2 Mac 实例（`mac2.metal`，**有 24 小时最短计费**，个人不划算）。
- 连上去之后的操作与路线 A 完全一致。
- 注意：AWS EC2 Mac 需要先在控制台申请 Dedicated Host，且只有 24h/72h 档位，成本通常在几十美元量级。

---

## 6. Electron 还是 Tauri？

| | Electron（本工程采用） | Tauri 2 |
|---|---|---|
| 安装包体积 | ~90–120 MB | ~5–15 MB |
| 内存占用 | 较高 | 低 |
| 打包产物 | `electron-builder` 一条命令出 dmg/zip | `tauri build` 出 `.app`/`.dmg` |
| 前置依赖 | 只需 Node | 需 Rust 工具链 + Xcode CLT |
| 后端能力 | 直接写 Node（`fs`、`fetch`、SQLite 随手可用） | 必须写 Rust（无 Node API，需要异步命令 + serde） |
| 学习成本（对 JS 背景） | 低 | 中高（要处理 capability 声明、序列化边界、线程阻塞） |
| 跨平台编译到 macOS | 不支持 | 不支持 |

**选型结论**：你这个应用的形态是「本地数据 + 三个页面 + 调飞书 REST 接口」，没有重计算、没有复杂原生能力。**Electron 的开发效率优势远大于 100 MB 体积的劣势**——尤其在没有 Mac 的情况下，Node 生态能让大部分逻辑在 Windows 上先跑通、先验收。

什么时候换 Tauri：包体成为硬指标（比如要给外部用户分发）、并且你已经有能写 Rust 的人。

---

## 7. 未签名 App 在别人 Mac 上怎么打开（Gatekeeper）

默认情况下（本工程 `"identity": null`，即**不签名**），对方第一次打开会被拦。

**方法一（推荐，命令行）**
```bash
xattr -dr com.apple.quarantine /Applications/YitangDaily.app
```
去掉"下载隔离"标记，之后双击即开。

**方法二（图形界面）**
- macOS 14 及更早：右键 App → `打开` → 弹窗里再点 `打开`。
- macOS 15 (Sequoia) 及更新：上面那招已被移除，需要去
  `系统设置 → 隐私与安全性` → 拉到底部，找到被拦截的 App → 点 `仍要打开`。

**方法三（应急，绕过签名校验）**
```bash
codesign --force --deep --sign - /Applications/YitangDaily.app
```
这是 **ad-hoc 签名**。Apple Silicon 上，可执行文件至少要有 ad-hoc 签名才能运行；如果对方看到"**App 已损坏，无法打开**"（而不是"无法验证开发者"），基本就是这个原因，跑上面这条命令即可。

---

## 8. 想做到"双击即开、零警告"：签名 + 公证

需要 **Apple Developer Program（99 美元/年）**，产出 `Developer ID Application` 证书。

1. 在 Keychain 里导入证书（`.p12`）。
2. 改 `package.json`：
   ```json
   "mac": {
     "identity": "Developer ID Application: 你的名字 (TEAMID)",
     "hardenedRuntime": true,
     "notarize": true
   }
   ```
3. 构建时提供公证凭据（三选一，推荐第三种）：
   ```bash
   # 方式一：Apple ID
   export APPLE_ID="you@example.com"
   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   export APPLE_TEAM_ID="TEAMID"

   # 方式二：App Store Connect API Key
   export APPLE_API_KEY="/path/AuthKey_XXXX.p8"
   export APPLE_API_KEY_ID="XXXX"
   export APPLE_API_ISSUER="xxxx-xxxx"

   # 方式三：钥匙串里存好 notarytool profile
   xcrun notarytool store-credentials "AC_PASSWORD" --apple-id ... --team-id ... --password ...
   ```
4. 走 GitHub Actions 时，把上面的值存进仓库 `Settings → Secrets and variables → Actions`，删掉工作流里的 `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` 即可自动签名。

公证通过后，对方双击就能打开，不再有"无法验证开发者"的提示。

---

## 9. 本工程结构

```
yitang-daily-qa/
├── package.json                     # 依赖 + electron-builder 全部打包配置
├── electron/
│   ├── main.js                      # 主进程：窗口、IPC、派生指标、成就判定
│   ├── preload.js                   # 唯一的安全桥（白名单 API）
│   ├── store.js                     # 数据真相源 + 过去 30 天历史数据编造
│   └── feishu-sync.js               # 飞书多维表格 OpenAPI 双向同步
├── src/
│   ├── index.html                   # 三个视图：每日问答 / 学习统计 / 成就记录
│   ├── styles.css                   # 浅色主题设计系统（白卡片 + 橙色主色）
│   ├── app.js                       # 渲染层（含 SVG 柱状图、热力图、折线图）
│   └── browser-mock.js              # 浏览器降级实现：双击 index.html 就能看设计
├── scripts/
│   ├── make-icon.js                 # 零依赖生成 1024×1024 图标（SDF 逐像素绘制）
│   └── smoke.js                     # 端到端冒烟测试（无界面跑通全部链路）
├── build/entitlements.mac.plist     # Hardened Runtime 权限声明
└── .github/workflows/build.yml  # macOS CI 构建流水线
```

**数据落在哪**：`app.getPath('userData')` → macOS 上是
`~/Library/Application Support/YitangDaily/state.json`（设置里点"打开数据目录"可直接跳过去）。

**改 UI 的最快方式**：直接双击 `src/index.html`，`browser-mock.js` 会自动接管并造一份模拟数据，完全不依赖 Electron。

**动手改代码之前，先跑一次冒烟测试**：

```bash
npm run smoke
```

它会以无界面方式加载**真实的主进程**，模拟「答一题 → 看数据有没有持久化 → 三个视图来回切 → 打开设置」，
把结果写进 `smoke-report.json`，并捕获所有 JS 错误 / 资源加载失败 / 渲染进程崩溃。
退出码 0 表示全绿。**这是把前端问题挡在 Mac 构建环节之前的最省事办法。**

---

## 10. 飞书同步怎么配

目的是把每天的答题记录写进一张飞书多维表格。步骤：

1. **建表**：飞书里新建一个多维表格，建好这些**同名列**：
   `日期`(日期) · `答题数`(数字) · `正确数`(数字) · `正确率`(数字) · `时长分钟`(数字) · `连续打卡`(数字)
2. **建应用，拿 App ID / App Secret**（共 4 小步）

   **2.1 进后台**
   打开 <https://open.feishu.cn/app> ，用你的飞书账号登录。
   （也可以从飞书网页端右上角点「开发者后台」进去。）
   > 个人版账号（`my.feishu.cn`）同样可以创建应用，不要求必须是企业版。

   **2.2 创建应用**
   点右上角 **创建企业自建应用**（个人账号可能显示成「创建应用」）。
   填三个东西：应用名称（比如「每日问答同步」）、应用描述、图标（可先跳过）→ 点 **创建**。

   **2.3 复制凭证** ← 这一步就是要拿的两个值
   左侧菜单 → **凭证与基础信息**
   - **App ID**：形如 `cli_xxxxxxxxxx`，直接复制
   - **App Secret**：点「查看」才显示，复制出来
   两个值都存好。**App Secret 等同于密码**，不要贴进代码、不要提交到 Git。

   **2.4 开通权限**
   左侧菜单 → **开发配置 → 权限管理 → API 权限** → 点「开通权限」
   - 搜索框里搜「多维表格」，勾选 **`bitable:app`**（查看、评论、编辑和管理多维表格）
   - 注意选 **应用身份**（我们用的是 `tenant_access_token`，不是用户身份）
   - 只读取数的话选 `bitable:app:readonly` 就够；要写入就必须 `bitable:app`

3. **创建版本并发布** ← 不做这步，前面全白配
   左侧菜单 → **应用发布 → 版本管理与发布** → **创建版本**
   - 版本号随便填（如 `1.0.0`）
   - 更新说明随便写一句
   - 最低兼容版本保持默认
   - 点 **保存** → **申请发布**

   **关于审核**：
   - 个人版 / 你自己就是管理员 → 通常很快通过或无需审批
   - 企业版 → 要等管理员在后台通过
   - **想立刻生效、绕开审核**：左侧「测试企业和人员」→ 创建测试企业 → 关联应用 →
     切到「测试版本」。测试版里权限改动**直接生效，不用审核**，适合先跑通再转正式。
4. **拿 app_token / table_id**

   **最省事的办法**——不用看 URL，直接跑：
   ```bash
   node scripts/list-feishu-tables.js <App ID> <App Secret> <app_token>
   ```
   它会列出这张多维表格里**所有数据表**的 `table_id` 和现有列名，
   并告诉你代码要求的 6 个列是否齐全。填进去就行。

   **手动找**——打开那张多维表格看地址栏：
   ```
   https://xxx.feishu.cn/base/XXXXXXXXXXXX?table=tblXXXXXX&view=vewXXXXXX
                           └── app_token ──┘        └─ table_id ─┘
   ```
   - `app_token`：`/base/` 后面那串。**前缀不固定**——老的多维表格是 `bascn` 开头，
     新版（尤其个人版 `my.feishu.cn`）就是一串没有规律的字符，**别拿前缀去判断对不对**，
     认准「`/base/` 后面到 `?` 为止」这一段即可。
   - `table_id`：参数 `table=` 后面那串，**始终 `tbl` 开头**，这个前缀是稳的
   - `view=` 那段不需要，忽略

   **两个常见麻烦**：
   - **地址栏里没有 `?table=`** → 点一下左侧的数据表名，切换后参数就出现了。
   - **链接不是 `/base/` 而是别的**（见下表）→ 说明表不在云空间里，URL 里抠不出 app_token。

   | 你的链接长这样 | 表在哪 | 怎么拿 app_token |
   |---|---|---|
   | `…/base/XXXX?table=tblXXX` | 云空间文件夹 | ✅ 直接看 URL |
   | `…/wiki/wikcnXXX` | 知识库 | ❌ URL 里没有，要调知识库 API 取 `obj_token` |
   | `…/docx/XXX` | 文档里嵌入的表格 | ❌ 要调「获取文档所有块」API，`bitable.token` 是 `app_token_table_id` 用下划线拼起来的 |
   | `…/sheets/XXX` | 电子表格里嵌入的 | ❌ 要调「获取表格元数据」API，找 `BITABLE_BLOCK` |

   **建议**：直接在云空间新建一个独立的多维表格（第一种），链接最干净，不用绕 API。
5. **⚠️ 关键一步**：在多维表格右上角 `...` → `更多` → **添加文档应用**，把刚才那个应用加为协作者（给编辑权限）。
   **不做这一步一定会写入失败**（报 permission denied），这是最常见的坑。
6. **填进 App**：打开 App → 左下角 `设置` → 勾选"启用飞书同步" → 填入 `App ID` / `App Secret` / `app_token` / `table_id` → 先点 `测试连接`，通过了再 `保存`。
7. 之后：答完题点右上角 `同步飞书`，当前进度会写入表格；左下角状态灯变绿表示成功。

> 密钥只存在本机 `userData/config.json`，不会随代码提交（`.gitignore` 已排除）。

### 10.1 在 App 里填写配置（逐小步）

1. **打开 App** —— 双击 `YitangDaily 0.1.0.exe`（免安装版）。
   首次打开 Windows 会弹 SmartScreen，点 **更多信息 → 仍要运行**。
2. **看左下角状态灯** —— 未配置时显示「飞书未配置」。
3. **点左下角「设置」** —— 弹出设置面板。
4. **填四项**（第 3、4 格建议用下面 §10.2 的办法预填，少输两串长字符）：

   | 格子 | 填什么 |
   |---|---|
   | 启用飞书同步 | 勾上 |
   | App ID | `cli_` 开头那串 |
   | App Secret | 开放平台点「查看」后复制的那串 |
   | app_token | `/base/` 后面那串 |
   | table_id | `tbl` 开头那串 |

5. **点「测试连接」** —— 会弹出结果提示：
   - 成功：`连接成功，已读到 N 条记录`
   - 失败：会带飞书返回的 `code`，对照 §11 排查
   > ⚠️ 注意：**点「测试连接」时配置已经写入本机了**，之后再点「保存」是再确认一次。
   > 所以不存在「先测试、通过后再保存」的先后顺序，两者都会落盘。
6. **点「保存」** → 关闭设置面板。
7. **验证** —— 左下角状态灯会变成「飞书待同步」；
   答完题点右上角 **同步飞书**，成功后灯变绿并显示同步时间。

**两个容易困惑的细节**：
- App Secret 那格是**密码框**，输入时看不到明文，正常。
- 保存后再次打开设置，那格是**空的**——不是没存上，
  占位文字会变成「已保存（留空表示不修改）」，只有要换密钥时才重新填。

### 10.2 预填配置（省得手输，重装后也能直接恢复）

配置就是一个 JSON 文件，直接写进去即可，App 启动时会读取：

- Windows：`%APPDATA%\yitang-daily-qa\config.json`
- macOS：`~/Library/Application Support/yitang-daily-qa/config.json`

内容形如：

```json
{
  "feishu": {
    "enabled": true,
    "appId": "cli_xxxxxxxxxxxx",
    "appSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "appToken": "<你的 app_token，/base/ 后面那段>",
    "tableId": "<你的 table_id，tbl 开头那段>"
  }
}
```

> **别把这些真实值写进 README 或任何提交进 Git 的文件**——本仓库是公开的。
> 上面一律用占位符，真实配置只放在本机 `config.json` 里（它不在仓库内）。

**改完必须重启 App 才会生效**——配置是启动时加载一次的。

> 注：开发模式（`npm start`）的数据目录是 `%APPDATA%\Electron`，
> 和打包后的 `%APPDATA%\yitang-daily-qa` 不是同一个，别改错地方。

---

## 11. 常见坑清单

1. **国内装 Electron 卡住/失败**
   Electron 的二进制默认从 GitHub 下载，国内经常超时。用镜像：
   ```bash
   ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
   ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" \
   npm install --registry=https://registry.npmmirror.com
   ```
   想永久生效就写进项目根目录的 `.npmrc`：
   ```
   registry=https://registry.npmmirror.com
   electron_mirror=https://npmmirror.com/mirrors/electron/
   electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
   ```

2. **Apple Silicon 上报"App 已损坏"**
   不是包坏了，是缺 ad-hoc 签名。见 §7 方法三。

3. **找不到签名证书导致构建中断**
   没有证书时必须显式关掉自动查找：构建时设 `CSC_IDENTITY_AUTO_DISCOVERY=false`，或配置里写 `"identity": null`（本工程已配置）。

4. **`npm install` 后 icon 没生成**
   `build/icon.png` 在 `.gitignore` 里（属于可再生产物），CI 上靠 `npm run icon` 重新生成；本地首次也跑一次即可。

5. **改了代码但 dmg 还是旧的**
   `electron-builder` 不会清理 `dist/`。删掉 `dist/` 或改 `version` 再构建。

6. **arm64 包在 Intel Mac 上打不开**（反之亦然）
   这就是为什么要 `--arm64 --x64` 两个都出，或者在 Mac 上按对方机型只出一个。

7. **别用 `npm i -g electron`**
   electron 必须是项目本地依赖，全局装会导致打包时版本对不上。

8. **在 Electron 应用的集成终端里跑 `npm start` 没反应**
   某些 IDE（本身是 Electron 写的）会把 `ELECTRON_RUN_AS_NODE=1` 传给子进程，
   导致 Electron 退化成普通 Node、`app` 变成 undefined。
   解决：先 `env -u ELECTRON_RUN_AS_NODE npm start`，或换用系统自带终端。
   （`npm run smoke` 遇到同样情况也用这个办法。）

9. **飞书同步后，新记录总是排在表格最下面**
   **这不是 bug，改代码也解决不了。** 飞书的记录写入接口只有「新增」，
   记录永远追加到末尾，没有「插到最前面」这个能力。
   **正确做法是在视图层加排序**：工具栏排序图标 → 字段选「日期」→ 降序。
   设一次长期有效，之后每天同步都会自动排在最上面。
   （如果表里还有空行占着位置，把空行删掉，看起来更干净。）

10. **同一天点了两次「同步飞书」，表格里出现两行重复记录**
    0.1.0 及更早会这样——当时只做新增、不查重。
    **0.1.1 起已修**：同步前先按「日期」列比对当天是否已有记录，有则更新那一条，没有才新建。
    需要重新出包（`npm run dist:win`）才会生效。表里已有的重复行手动删掉多余的那行即可。

    > 实现上有个坑值得记：日期比对**不能**用「时间差 < 一天」当容差，
    > 那样「昨天 23:59:59」也会被判成同一天，**会把前一天那行覆盖掉**。
    > 正确规则是只接受两种差值：完全相同，或「整小时且 ≤14 小时的时区偏移」。
    > 见 `electron/feishu-sync.js` 里 `findRecordIdByDate()` 的注释。

---

## 12. 出 Windows 版（本机直接就能打）

macOS 包要靠 CI，但 **Windows 包在这台机器上一条命令就出**，不用等 CI、不用任何签名。

```bash
npm run dist:win
```

产物在 `dist/`，一次出**两种**，按需取用：

| 文件 | 形态 | 适合 |
|---|---|---|
| `YitangDaily 0.1.0.exe` | **免安装版（portable）** | 双击直接运行，不写注册表、不需要管理员。拷给别人或放 U 盘都能用 |
| `YitangDaily Setup 0.1.0.exe` | 安装版（NSIS） | 走安装向导，可改安装目录，会建开始菜单快捷方式 |
| `win-unpacked/` | 未打包目录 | 调试用，里面有可直接双击的 `YitangDaily.exe` |

**首次打开会被 SmartScreen 拦一下**（未签名程序的正常表现）：
弹窗点 **更多信息** → **仍要运行** 即可，之后不再提示。
想彻底没有提示，需要买代码签名证书（OV/EV）并用 `signtool` 签名，年费通常一两千元起——
自用或内部小范围分发没必要。

---

## 13. 下一步

```bash
# 在本机先跑起来看效果
npm start

# 无界面自检：答题链路 + 三视图 + 设置弹窗，全绿再打包
npm run smoke

# 出 Windows 版（本机直接出，2~3 分钟）
npm run dist:win
```

然后二选一：
- **有 Mac** → 走 §3，`npm run dist:mac:all`。
- **没 Mac** → 走 §4，推到 GitHub，点一次 `Run workflow`。
