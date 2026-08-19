# NVCI 在 fnOS NAS 上的部署与验收清单

> 目标：将 NVCI 容器化工作台部署至 NAS `10.10.10.218`，并以局域网地址 `http://10.10.10.218:8787` 提供访问。

## 已完成的准备

| 项目 | 状态 | 说明 |
|---|---:|---|
| GitHub 源码仓库 | 已同步 | <https://github.com/apllozhang/NVCI>（公开仓库） |
| 当前部署提交 | `411b12a` | 包含 Docker Compose、健康检查、回归测试及 NAS 引导脚本 |
| 本地回归测试 | 通过 | `vendorCount=5`、`productCount=8`、路径健康检查决策正常 |
| 机密文件 | 未提交 | `.env`、管理员密码、会话密钥及运行时资料均被 Git 忽略 |

## 在 NAS SSH 终端执行

请在**与 NAS 同一局域网**的终端中登录 NAS，然后运行以下命令。该脚本会拉取公开仓库、首次部署时交互式要求设置本地管理员密码，并只在 NAS 本地生成 `.env` 会话密钥。

```bash
ssh alec@10.10.10.218
sudo -i
curl -fsSL https://raw.githubusercontent.com/apllozhang/NVCI/main/scripts/nas-deploy.sh -o /tmp/nas-deploy.sh
sh /tmp/nas-deploy.sh
```

部署脚本默认使用目录 `/vol1/1000/docker/nvci`。如该目录已有无关文件，请先改用空目录：

```bash
NVCI_APP_DIR=/vol1/1000/docker/nvci sh /tmp/nas-deploy.sh
```

## 首次部署时的输入与预期输出

脚本会提示输入一个至少 12 位的管理员密码；输入不会回显。请勿把密码写入命令行、聊天消息、GitHub 或截图。成功后应显示容器状态，容器名称为 `nvci-workbench`。

如果脚本提示缺少 `git`，先确认系统包管理器可用后安装 Git，再重新执行脚本：

```bash
apt-get update && apt-get install -y git
```

## 部署后验收

在 NAS 终端执行：

```bash
cd /vol1/1000/docker/nvci
docker compose ps
docker compose logs --tail=50
docker inspect nvci-workbench --format='{{.State.Health.Status}}'
```

在同一局域网浏览器访问：

```text
http://10.10.10.218:8787
```

登录后检查以下项目：

| 验收项目 | 预期结果 |
|---|---|
| 登录页 | 正常展示并可使用首次设置的管理员密码登录 |
| 控制台 | 厂商记忆为 5 个，产品状态为 8 个 |
| 路径健康检查 | 返回 `reuse_unchanged_or_compare_metadata` |
| Docker 健康状态 | `healthy` |

## 后续更新

之后每次更新仅需重新运行引导脚本；它会执行快进式拉取，保留既有 `.env`、管理员密码、会话密钥和 Docker 命名卷数据。

```bash
sudo -i
curl -fsSL https://raw.githubusercontent.com/apllozhang/NVCI/main/scripts/nas-deploy.sh -o /tmp/nas-deploy.sh
sh /tmp/nas-deploy.sh
```

## 已知网络边界

当前自动化执行环境无法路由到 NAS 的私有地址 `10.10.10.218:22`，SSH 连接会超时。因此必须由同一局域网的终端执行上述命令，或后续连接一个可执行 SSH 命令的同网段桌面环境。部署完成后，把 `docker compose ps`、`docker compose logs --tail=50` 和健康状态命令的输出发回即可继续完成验收。
