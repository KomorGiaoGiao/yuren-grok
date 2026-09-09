# Grok Desktop 项目测试与体验评审

日期：2026-09-09。对象：`project/`，Tauri 2 + React 19 + TypeScript 桌面应用。

**结论：界面框架已具备可用的原型质量，但错误恢复、会话状态隔离和权限处理尚不适合直接作为稳定版发布。优先修复数据/权限正确性，再优化交互和视觉。**

本次进行了现有测试全量执行、补充风险用例、真实 Rust 文件读写/解析测试、历史截图回归、三语言两尺寸布局检查和构建验证。测试通过率仅针对本文用例，不代表代码覆盖率或线上成功率。业务源码和原有截图基线未修改；新增测试保留失败状态，供修复后复跑。

## 范围与架构

- `src/App.tsx`：约 1,500 行，集中管理导航、历史、流式输出、权限、设置和会话元数据，异步状态耦合较重。
- `src/api.ts`：Tauri invoke 与事件桥接。
- `src-tauri/src/agent.rs`：Grok CLI 子进程、ACP JSON-RPC、权限回复、流式事件。
- `settings.rs / sessions.rs / skills.rs / plugins.rs`：本地配置、会话文件和 CLI 扩展管理。
- `tests/visual`：6 条测试、7 张既有截图基线，使用模拟 Tauri，不运行真实 ACP。
- 同级 `grok-desktop/` 是 Grok-1 JAX 模型参考仓库，不是桌面 UI。未下载 314B 模型权重或执行 GPU 推理。

环境：macOS arm64，Node 24.15.0，Rust 1.98.1，React 19.2.8，Playwright 1.63.0。浏览器自动化使用本机 Chrome。

## 执行结果

| 检查 | 结果 | 解释 |
|---|---|---|
| `npm run build` | 通过 | TypeScript 与 Vite 生产构建完成；主 JS 580.47 kB，gzip 179.84 kB，有超过 500 kB 的打包提示 |
| 原有 `cargo test --all-targets`，新增测试前 | 1 通过 | 原本只有技能列表测试，并依赖本机存在 ponytail 技能，移植性不足 |
| 原有视觉套件 | 4 通过 / 2 失败 | 选择器重名 1 条；技能页基线差异 1 条 |
| 新增浏览器审计套件 | 13 通过 / 13 失败 | 共 26 条，含 17 条行为用例、6 条语言/尺寸布局用例、3 条独立截图对比 |
| 新增真实 Rust 后端测试 | 4 通过 / 2 失败 | 共 6 条，使用临时 GROK_HOME，未写入真实配置 |
| `cargo clippy --all-targets -- -D warnings`，新增测试前 | 失败 | agent.rs 嵌套 if、skills.rs sort_by 两项 lint；不是编译或运行崩溃 |
| `cargo fmt --check`，新增测试前 | 失败 | 已有源码不满足 rustfmt 格式 |
| `npm run tauri build -- --debug --no-bundle` | 通过 | 原生可执行文件构建成功 |
| `npm run tauri build -- --debug --bundles app` | 通过 | macOS .app 打包成功，未验证签名、公证、安装升级 |
| 原生 .app 启动与只读导航 | 通过基础冒烟 | 识别 Grok CLI 1.0.13，真实会话列表、设置、技能可读取；插件页可打开 |

首次视觉测试被沙箱阻止监听端口，解除该环境限制后才计入上述结果。没有把环境启动失败算作产品缺陷。

报告与证据：`results.json`、`run.log`、`backend.log`、`rustfmt.log`、`tauri-build.log`；浏览器详情见 `html/index.html`，失败用例保留截图和 trace.zip。

## 视觉回归与视觉评价

原配置表面设置为 1280×800，但项目级 `Desktop Chrome` 设备预设实际覆盖为 **1280×720**。本次独立基线复测使用 1280×720，避免尺寸混淆。

- 原套件中的 `getByRole("button", { name: "app" })` 同时匹配 `Grok Desktop App` 和项目 `app`，导致首个用例在截图前失败。建议设置 `exact: true`，并把多页截图拆成独立用例。
- 补充独立对比后，空会话和插件页基线均通过；结合原套件，**7 张既有基线中 6 张通过，1 张失败**。
- 技能页存在 **7,506 像素差异，约 0.814%**，略高于配置阈值 0.8%。差异图显示顶部工作目录显示、文字与纵向位置等发生变化。当前截图未见明显控件重叠，因此应由设计/产品确认是否接受改动，不能自动把基线更新视为修复。
- 新增简体中文、繁体中文、英文 × 960×640、1320×860 的 6 条布局场景，合计保存 24 张页面截图。基础控件横向边界检查通过；设置页属于可滚动内容，不把离开首屏直接当作溢出。这些新截图没有历史基线，属于本轮视觉巡检，不宣称历史回归通过。

主观视觉评分 **7/10**：暗色层级和侧栏宽度统一，输入框和会话区结构清晰，代码/差异信息有基本层级。主要体验改进：

1. 最小窗口下设置页的保存按钮与 OAuth 区域位于首屏以下，建议压缩卡片间距或增加固定保存区，并保留可见的滚动提示。
2. 项目名称/当前目录在输入区缺少清晰展示，欢迎语却要求“在输入框下方选择目录”，实际入口藏在加号菜单。建议增加明确的工作目录选择器。
3. 插件空状态只有解释，没有安装/查看安装指引入口；市场地址表现为低对比纯文本。已安装插件时 lead 文案仍写“你当前没有安装任何插件”，应按状态生成。
4. 简体文案混用“请求核准、封存、钉选”和英文工具状态；统一为目标用户习惯的中文，并将动态工具文案接入 i18n。
5. 权限弹窗、错误条需要更强的状态与操作提示；颜色统一不等于可访问性合格，本轮未做完整对比度或屏幕阅读器认证。

## 已复现问题与修改点

P1 表示发布前优先修复；P2 表示重要体验/一致性问题。以下自动化复现主要来自受控 IPC fixture，后端问题另行注明，不能理解为真实 Grok CLI 已触发全部边界。

| ID | 优先级 | 触发与实际结果 | 修改方向与验收标准 | 位置 |
|---|---|---|---|---|
| A01 | P1 | 权限 options 只有 allow_once 时，点击“拒绝”实际发送 allow 选项 | 禁止拒绝回退到第一个 option；不支持拒绝时禁用按钮或用协议取消；断言拒绝绝不产生 allow | `src/components/PermissionModal.tsx:29` |
| A02 | P1 | 中文输入法 composing=true 的 Enter 清空输入并发送 | 检查 isComposing / 229；选词不提交，结束组合后的 Enter 才发送；补真实 macOS 输入法验证 | `src/App.tsx:957` |
| A03 | P1 | 首次连接失败后 draft 为空，原错误会被泛化文案覆盖 | 保留草稿和原始错误；连接成功且提交受理后清空；支持重试 | `src/App.tsx:456`、`:502` |
| A04 | P2 | 已连接会话发送失败后没有恢复草稿或重试按钮 | 显示消息 failed 状态和重试；保留原始文本，不要求用户从气泡手动复制 | `src/App.tsx:456` |
| A05 | P1 | 模拟连接延迟 300ms，连续提交两次，产生两个 start_session 调用 | 单飞连接 Promise / 提交锁，connecting 状态禁用重复提交 | `src/App.tsx:377`、`:502` |
| A06 | P1 | 新会话建立后注入旧 sessionId 更新，旧内容出现在新会话 | 保留事件 sessionId，按当前会话和 generation 过滤；过期异步回调不得更新当前 UI | `src/App.tsx:221`、`:1439` |
| A07 | P1 | 模拟 agent-exit 后 UI 一直 busy | 监听退出事件；后端 EOF 清空 pending 并通知失败；恢复输入并明确中断原因 | `src/api.ts:60`、`src-tauri/src/agent.rs:375` |
| A08 | P2 | 有待处理权限时程序触发新会话，旧弹窗保留 | 新会话/停止/退出统一清理权限并取消旧请求；本例是生命周期测试，不是可穿透遮罩的鼠标路径 | `src/App.tsx:356` |
| A09 | P2 | 权限框无 dialog 语义 | 加 role=dialog、aria-modal、可访问标题、初始焦点、焦点陷阱和关闭后焦点恢复；目前自动化在缺失 dialog 语义处失败 | `src/components/PermissionModal.tsx:22` |
| A10 | P2 | 保存设置时模拟只读磁盘错误，页面不展示错误 | try/catch/finally，保存中禁用按钮，显示失败与重试，不得显示过期成功状态 | `src/App.tsx:1251` |
| A11 | P2 | 插件命令超时后页面显示“还没有安装插件” | 区分 loading / empty / error，后端保留错误；提供重试 | `src/App.tsx:588`、`src-tauri/src/plugins.rs:35` |
| A12 | P2 | 重命名后侧栏显示新标题，搜索新标题没有结果 | 搜索和侧栏共用 effective title / session metadata；覆盖重命名、归档和恢复 | `src/components/SearchPalette.tsx:28`、`src/App.tsx:1121` |
| B01 | P1 | 真实 Rust 测试：空配置首次禁用技能，在 `doc["skills"]["disabled"]` 处 panic | 用 get/as_array 安全读取缺失键并初始化；空配置、已有配置都能开关技能 | `src-tauri/src/skills.rs:61` |
| B02 | P2 | 真实 Rust 测试：两个无 frontmatter 的独立 .md 命令都变成 commands，去重后剩一个 | 独立 .md 默认名称取 file_stem；只有 SKILL.md 取父目录名；断言两个命令同时保留 | `src-tauri/src/skills.rs:145` |

截图、断言和对应具体失败信息可在 HTML 报告中按英文用例名称检索。B01、B02 的 panic/实际名称在 backend.log 中。

## 代码审查发现的风险（尚未做真实 CLI 端到端复现）

- **运行时模型/思考强度可能未实际切换**：前端 changeRuntime 调用 resumeSession，AgentHub 优先 attach_existing；后者只发送 session/load，忽略 req.model 和 req.reasoning_effort。建议使用 CLI 支持的会话配置 RPC 或明确重启进程，在真实服务侧验证实际模型，不以选择框变化代替验收。
- **子进程退出/超时的 pending 清理不完整**：EOF 只发 agent-exit；RPC 超时不移除 map 条目。prompt 超时为 1800 秒，退出后可能长时间挂起，需可控 fake CLI 测试断管、超时与取消竞态。
- **登录状态刷新不完整**：login_browser spawn 后即返回 started，UI 用旧 settings 更新；logout 没重新读取状态。需要轮询/事件确认登录成功，并在退出后刷新。
- **滚动体验**：blocks 每次变化都 scrollTo 底部，阅读历史时遇到流式输出可能被拉回底部；应只在用户接近底部时跟随，提供“回到最新”。
- **封存恢复入口缺失**：存在 archived 元数据和 unarchive 文案，但 UI 没有完整的已封存列表/恢复操作；搜索仍取原始 sessions。
- **窗口和跨平台支持**：open_path 硬编码 macOS `open`，PATH 拆分使用冒号；本轮仅 macOS，不能宣称 Windows/Linux 已支持。
- **测试基础设施**：原有后端测试依赖用户机器上的 ponytail 技能，`test:visual` 名称实际同时承载功能断言；建议独立 unit/integration/e2e/visual 任务，并固定截图环境。

## 综合评价与修复顺序

以下为基于本次样本的主观工程评分，不是统计测量：视觉 7/10；正常路径 6/10；异常恢复 3/10；权限与会话状态正确性 3/10；测试基础 4/10。**整体约 5/10：可继续内部试用，不建议直接发布稳定版。**

第一批：A01、A02、A03、A05、A06、A07、B01。先消除误授权、误发送、丢草稿、会话串流、卡住和 panic。

第二批：A04、A08–A12、B02，并核实模型切换与登录状态。统一 error/loading/empty 展示，修复搜索元数据一致性。

第三批：工作目录入口、最小窗口设置布局、插件空状态、自动滚动和本地化。让这些交互稳定后，审阅技能页差异并批准更新基线；不要先放宽截图阈值。

## 复跑方式

在 project 目录执行：

```sh
npm run build
npm run test:visual -- --update-snapshots=none
npm run test:visual -- --config=playwright.audit.config.ts --update-snapshots=none
cargo test --manifest-path src-tauri/Cargo.toml --test audit_backend audit_ -- --test-threads=1
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npm run tauri build -- --debug --no-bundle
```

新增测试：playwright.audit.config.ts、tests/audit/experience.spec.ts、src-tauri/tests/audit_backend.rs。

## 原生启动检查

本机起初没有可定位的已安装 com.grok.desktop 应用。本次构建 debug .app 后，通过 Computer Use 以完整路径启动，成功加载 tauri://localhost，确认 Grok CLI 1.0.13、真实会话列表、设置与技能页面可读取。没有保存真实配置、切换真实技能开关或发起模型请求。插件页显示空状态；由于产品会吞掉命令错误，这不等于验证后端插件命令成功。原生数据截图未放入共享报告，避免夹带用户真实会话信息。

构建产物：`src-tauri/target/debug/bundle/macos/Grok Desktop.app`。打包日志：`tauri-bundle.log`。

## 测试边界

这次是现有测试的全量运行和主要风险导向补测，并非穷尽所有功能/数据组合。未测真实收费模型请求、真实工具执行与授权、OAuth 全流程、插件安装网络链路、长时间内存/CPU 压测、万级历史记录、签名/公证/安装升级、Windows/Linux、完整屏幕阅读器流程。新增功能用例使用模拟 IPC；真实 Rust 测试验证文件解析和持久化，不涉及真实账号密钥。不能把这些结果称为全部真实端到端通过。
