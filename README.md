# 微聊 — 跨平台聊天软件

一套 TypeScript 代码，覆盖 **iOS / Android / Windows / macOS** 四端，外加自带的实时聊天服务端。

界面和业务逻辑只写一份：手机端由 Expo(React Native) 直接编译成原生应用，桌面端复用同一份代码的
React Native Web 产物，用 Electron 壳打包成 Windows / macOS 客户端。

**两条消息通道**：能直连就直连（消息完全不经过服务器，端到端加密），连不上自动回落到服务器中转。
全程支持 IPv6。

---

## 目录结构

```
packages/shared/     四端 + 服务端共用的类型、REST 客户端、WebSocket 客户端、工具函数
server/              Node + Express + ws + SQLite 的聊天服务端
apps/app/            Expo 应用（iOS / Android / Web 三个目标共用一份代码）
apps/desktop/        Electron 壳，加载 apps/app 的 Web 产物，产出 Windows / macOS 安装包
```

依赖方向是单向的：`apps/*` 和 `server` 都依赖 `packages/shared`，彼此不互相依赖。
协议一旦改动，改 `packages/shared/src/types.ts` 一处，四端和服务端一起报编译错误，不会出现某一端漏改。

---

## 已实现的功能

| 功能 | 说明 |
| --- | --- |
| 注册 / 登录 | bcrypt 存密码，JWT 鉴权，token 存本地，冷启动自动续登 |
| 找人 | 按用户名 / 昵称模糊搜索 |
| 一对一实时聊天 | WebSocket 双向推送，毫秒级送达 |
| 消息持久化 | SQLite（WAL 模式），历史消息支持向上翻页 |
| 离线消息 | 离线期间的消息重新上线后自动补齐，未读数正确累计 |
| 未读数 | 服务端权威计算，多端一致 |
| 已读回执 | 对方读到哪条，自己这边的气泡显示「已读 / 已送达」 |
| 正在输入 | 实时转发，停手 2.5 秒自动撤销 |
| 在线状态 | 头像右下角绿点 + 聊天页顶部「在线 / 离线」 |
| 断线重连 | 指数退避 + 抖动，重连后自动补拉漏掉的消息 |
| 离线发送队列 | 断网时发的消息进队列，恢复后自动补发 |
| 消息幂等 | 每条消息带 clientId，服务端唯一索引兜底，重复补发不会产生重复消息 |
| 多端同时在线 | 同一账号手机和电脑可同时登录，消息同步推送 |
| 本地缓存 | 冷启动先渲染上次的会话和消息，再后台刷新，不会白屏 |
| 深色 / 浅色 | 跟随系统 |
| 响应式布局 | 窗口 ≥900px 自动切三栏（桌面），否则单栏 + 底部标签栏（手机） |
| 点对点直连 | 局域网自动发现 + 公网 IPv6，消息不经服务器，端到端加密（详见下一节） |
| IPv6 | 服务端双栈监听，客户端地址、P2P 地址全链路支持 |

**尚未实现**（这一版按约定只做单聊 MVP）：群聊、图片/文件、语音视频、消息撤回、推送通知。
数据库表结构已经按群聊设计（`conversations.type` 支持 `group`），加群聊不需要改表。

---

## 点对点直连（不经过服务器）

私聊会话在能直连时，消息**完全不经过服务器**——服务器连密文都看不到。连不上才回落到中转。
聊天页右上角实时显示当前走的是哪条通道。

### 两条直连路径

| 路径 | 怎么找到对方 | 可用性 |
| --- | --- | --- |
| **局域网直连** | Bonjour/mDNS 自动发现，同一个 Wi-Fi 下点开就连上 | 稳定，基本必通 |
| **公网 IPv6 直连** | 扫二维码交换地址（也可复制粘贴配对码） | 尽力而为，取决于运营商防火墙 |

**关于跨网络直连要把话说清楚**：IPv4 下两台手机基本不可能直连——国内运营商移动网络普遍是
CGNAT，双方都没有公网地址。IPv6 是唯一现实解法（三大运营商手机现在基本都有公网 IPv6），
但**不少运营商默认拦截入站连接**，所以这条路是尽力而为，连不上会自动走服务器。
如果你要的是"任何网络下都必通的纯 P2P"，那需要 WebRTC + TURN 中继，而 TURN 本身又是服务器。

### 安全性

直连不代表明文裸奔，握手做了完整的双向认证和加密：

- 每台设备首次启动生成 **ed25519 长期密钥对**，私钥永不离开设备，服务器只拿到公钥
- 握手用 **x25519 临时密钥做 ECDH**（每次连接都换，前向保密），双方各自对完整握手记录签名
- 会话密钥由 **HKDF** 从共享密钥 + 握手记录派生，收发方向用两把不同的密钥（防反射攻击）
- 消息用 **XChaCha20-Poly1305** 加密，nonce 用递增计数器，不重复
- 对端公钥和预期不符（中间人）会**直接断开**；扫码配对过的好友公钥会被 pin 住

设置页能看到本机的**设备指纹**（公钥前 8 字节），当面配对时可以互相核对。

### 用起来是什么样

1. 同一个 Wi-Fi：什么都不用做，打开就自动发现并连上，气泡右上角变成「🔒 局域网直连」
2. 不同网络：**通讯录 → 面对面配对**，一方出示二维码，另一方扫一下
3. 都连不上：自动走服务器，标识变成「☁️ 服务器中转」，用户无感

### 限制（重要）

- **P2P 消息只存在两台设备本地**。这是"不经过服务器"的必然代价：换手机不会同步这些记录，
  对方不在线也发不出去（会留在本地队列）。需要离线消息和多端同步的场景，走服务器通道。
- **P2P 需要原生 socket，Expo Go 里跑不了**，必须打 dev build：
  `npx eas build --profile development`。浏览器里也不支持（会显示「服务器中转」）。
- 桌面客户端的直连通过 Electron 主进程的 TCP 桥实现，浏览器直接访问 Web 版则没有直连能力。

---

## IPv6 支持

- 服务端默认绑 `::`（双栈，同时收 IPv4 和 IPv6），主机没开 IPv6 会**自动退回 `0.0.0.0`**，不会起不来
- 启动时把本机的局域网 IPv4 和公网 IPv6 地址都列出来，直接复制到客户端就能用
- 客户端地址输入框认 IPv6：`2408:8207::1` 会自动补成 `http://[2408:8207::1]:4000`，
  已经写好方括号和端口的原样保留，WebSocket 地址转换也保留方括号
- P2P 监听同样绑 `::`，一个端口同时接受 IPv4 和 IPv6 连接
- 配对码里的地址会过滤掉回环、链路本地（`fe80::`）、唯一本地（`fc00::/7`）这些对端连不上的地址，
  只保留全局可路由的 IPv6 和私网 IPv4

---

## 快速开始

### 1. 安装依赖

```bash
npm install                      # 根目录，自动安装并构建 shared
npm --prefix apps/desktop install   # Electron 单独装（不在 workspace 里）
```

### 2. 启动服务端

```bash
npm run dev:server
```

启动后会打印监听地址和**所有可填的服务器地址**——手机真机调试时用局域网那条，不能用 localhost。

```
聊天服务已启动
  监听地址   :: (IPv4 + IPv6 双栈)
  REST       http://localhost:4000/api
  WebSocket  ws://localhost:4000/ws
  数据库      ./data/chat.db

客户端可填的服务器地址：
  http://192.168.1.10:4000            (局域网，同 Wi-Fi 可用)
  http://[2408:8207:1::abcd]:4000     (公网 IPv6)
```

### 3. 启动客户端

```bash
npm run dev:app        # 起 Expo，扫码在手机上跑，或按 i / a 开模拟器
npm run dev:web        # 浏览器里跑（等价于桌面端界面）
npm run dev:desktop    # Electron 窗口（需要先跑上面的 dev:web）
```

> 客户端会自动猜服务器地址（模拟器用 10.0.2.2 / localhost，真机从 Expo 的 hostUri 里取电脑 IP）。
> 猜错了就在 **登录页 →「服务器设置」** 或 **我 → 服务器地址** 里手填，带「保存并测试连接」。

---

## 打包发布

### iOS / Android

用 Expo 的云构建（EAS），不需要本地装 Xcode / Android Studio：

```bash
cd apps/app
npx eas login
npx eas build:configure

npx eas build --platform android --profile preview      # 出 APK，直接装手机上试
npx eas build --platform ios --profile preview          # 出模拟器包
npx eas build --platform all --profile production       # 上架用的 aab + ipa
```

`eas.json` 里的 `EXPO_PUBLIC_SERVER_URL` 记得改成你自己的服务器地址——打包后的应用没法再自动猜到开发机 IP。

想本地出包的话先 `npx expo prebuild` 生成原生工程，再用 Xcode / Gradle 编译。

### Windows / macOS

```bash
cd apps/desktop
npm run dist:win     # 出 NSIS 安装包 + 免安装版（x64 / arm64）
npm run dist:mac     # 出 dmg（Intel / Apple Silicon）
```

产物在 `apps/desktop/release/`。

> 交叉编译有限制：macOS 的 dmg 必须在 Mac 上打；Windows 包在 Linux/macOS 上打需要装 wine。
> 最稳的方式是各自在对应系统上跑，或者用 GitHub Actions 的 windows/macos runner。

### 服务端部署

```bash
docker build -f server/Dockerfile -t chat-server .
docker run -d -p 4000:4000 \
  -e CHAT_JWT_SECRET="$(openssl rand -hex 32)" \
  -v chat-data:/data \
  chat-server
```

生产环境务必：

- 设置 `CHAT_JWT_SECRET`（不设会直接拒绝启动）
- 前面挂 Nginx/Caddy 上 HTTPS，客户端地址填 `https://`，WebSocket 会自动走 `wss://`
- 反代要放行 WebSocket 升级头（`Upgrade` / `Connection`）

环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `4000` | 监听端口 |
| `HOST` | `::`（失败退回 `0.0.0.0`） | 监听地址，默认双栈 |
| `CHAT_JWT_SECRET` | 开发时自动生成 | JWT 密钥，生产必填 |
| `CHAT_DATA_DIR` | `./data` | 数据目录 |
| `CHAT_DB_FILE` | `$CHAT_DATA_DIR/chat.db` | SQLite 文件路径 |
| `CHAT_TOKEN_TTL` | `30d` | token 有效期 |
| `CHAT_CORS_ORIGIN` | `*` | 允许的前端来源，多个用逗号分隔 |

P2P 直连默认用 **4310** 端口。跨网络直连时，如果路由器有 IPv6 防火墙，需要放行这个端口的入站连接。

---

## 测试

```bash
npm run test:server    # 服务器模式，20 个用例
npm run test:p2p       # 点对点直连，16 个用例
```

**服务器模式（20 个）**：真的起一个 HTTP + WebSocket 服务，用共享层的客户端跑完整流程——
注册登录、鉴权拒绝、搜人、建会话去重、实时收发、ack、未读数、已读回执、消息幂等、
离线补发、历史翻页、越权访问拦截、伪造 token 拦截、正在输入转发、设备端点注册与推送。

**点对点直连（16 个）**：用真实 TCP socket 跑完整握手和加密通道——
粘包拆包、超长帧防护、IPv4/IPv6 直连、双向收发、连发 21 条验证 nonce 不错位、
心跳、**公钥不符时拒绝连接（防中间人）**、**伪造签名无法通过握手**、握手超时、
配对码编解码、地址过滤、IPv6 地址判定与 URL 补全。

> IPv6 直连那条用例需要主机有 IPv6 协议栈，没有的话会明确 SKIP 而不是假装通过。

---

## 接口

REST 前缀 `/api`，除 `health` 和 `auth/*` 外都要带 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/auth/register` | 注册，返回 token + user |
| POST | `/auth/login` | 登录 |
| GET | `/me` | 当前用户 |
| GET | `/users/search?q=` | 搜索用户 |
| GET | `/conversations` | 会话列表（含成员、最后一条消息、未读数） |
| POST | `/conversations/direct` | 开私聊，已存在则复用 |
| GET | `/conversations/:id/messages?before=&limit=` | 历史消息，时间升序 |
| POST | `/conversations/:id/read` | 标记已读 |
| POST | `/devices` | 上报本设备的 P2P 公钥和地址 |
| DELETE | `/devices/:publicKey` | 注销设备端点 |

WebSocket 连 `/ws?token=<jwt>`（RN 和浏览器的 WebSocket 都不支持自定义请求头，所以 token 走 query）。
事件类型定义在 `packages/shared/src/types.ts` 的 `ClientEvent` / `ServerEvent`。

---

## 一些实现上的取舍

- **消息 id 用自增 `seq` 排序**，不靠时间戳。时钟回拨或同毫秒并发都不会打乱顺序，翻页游标也稳定。
- **未读数由服务端算**，客户端不自己累加。多端同时在线时不会各算各的。
- **`clientId` + 唯一索引做幂等**。断线重连补发是必然会发生的，靠数据库约束兜底比靠客户端自觉可靠。
- **登录态离线可用**。网络不通时不登出，只有服务端明确返回 401/403 才清 token。
- **Electron 里起了个本地静态服务**而不是用 `file://`。Expo 的 Web 产物用绝对路径引资源，`file://` 下会全部 404。
- **服务器在 P2P 里只当通讯录**，存公钥和地址，不参与加密也不中转消息。这样即使服务器被攻破，
  直连过的历史消息也不在上面。
- **P2P 消息 id 用 `p_` 前缀**，和服务器的 `m_` 区分开。已读上报时会跳过 `p_` 开头的 id，
  免得拿服务器不认识的消息 id 去请求它。
- **两端同时拨号会产生两条连接**，用设备公钥字典序做确定性取舍，保证两端留下的是同一条。

---

> 仓库根目录的 `Dockerfile` 和 `config.json` 是之前的 sing-box 配置，与本项目无关，未做改动。
