# 桌面应用自动更新

桌面版在启动约 3 秒后检查更新；也可打开「偏好设置 → 软件更新」手动检查。
发现新版后先下载，显示下载进度，下载成功且签名验证通过后才显示安装按钮。
点击「保存并安装更新」会先保存所有未保存文档。取消保存、保存失败或出现新的未保存更改都会停止安装。
安装时暂时禁止编辑。Windows 安装器完成后重新启动应用。
浏览器版只显示当前版本，更新按钮不可用。

这是整个桌面应用的升级，需要重新启动。旧版没有更新插件，必须手动安装一次包含本功能的版本，之后才能在应用内升级。

## 首次配置发布签名

更新来源是本仓库的 GitHub Releases，应用读取：

```text
https://github.com/ghost0211/markdown-editor/releases/latest/download/latest.json
```

更新器使用 `src-tauri/tauri.conf.json` 中的公钥验证安装包。配置的公钥与本次在开发机生成的密钥对应：

```text
C:\Users\chentao\.tauri\markdown-editor-updater.key
C:\Users\chentao\.tauri\markdown-editor-updater.key.pub
```

私钥仅存放在本机，未加入仓库。应备份私钥；更换或丢失它会使已安装版本无法验证以新密钥签名的更新。

在仓库的 Settings → Secrets and variables → Actions 中配置：

| Secret | 内容 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | 本机 `.key` 文件的完整内容，不能填写本机文件路径 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码；本次生成的密钥没有密码，可不设置 |

不要把私钥写入代码、工作流、日志或 Release 附件。

## 发布新版

1. 同步修改 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 的应用版本。
2. 提交后推送与版本相同的 `v` 标签，例如 `v1.6.1`。也可手动触发 Release 工作流，并指定已有版本标签。
3. 工作流运行测试，使用签名密钥构建 MSI 和 NSIS 安装器，并发布安装器、`.sig` 签名及 `latest.json`。
4. 已安装的旧版本读取 `latest.json` 后即可下载新版。更新清单优先使用 NSIS 安装器。带 `-beta` 等后缀的标签发布为预发布版，不进入稳定版的 latest 更新入口。

首次发布前还没有 `latest.json` 时，检查更新可能显示服务端 404；发布第一份签名更新清单后才能完成线上检查。

## 本机打包

PowerShell 中将私钥路径传给 Tauri，再执行打包：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Join-Path $env:USERPROFILE '.tauri\markdown-editor-updater.key'
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
npm run tauri -- build
```

公钥已经随应用打包，运行更新器时不需要私钥。不要为已发布的更新器随意重新生成密钥。

## 验证范围

单元测试覆盖版本检查、进度、重复请求、下载/签名失败、保存取消、安装失败和重启重试。
首次发布前还需在测试机安装含更新器的旧版本，再发布更高版本，验证实际下载、签名检查、安装和文档恢复；本地模拟成功不能替代这一步。
