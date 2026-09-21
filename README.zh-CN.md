# OrbitoDB

> 基于 Rust、Tauri、React 与 SQLx 的轻量、本地优先数据库工作台。

[English](README.md) · [安全策略](SECURITY.md)

OrbitoDB 面向 PostgreSQL、MySQL / MariaDB 与 SQLite 的日常数据库工作。目标是在保持轻量、本地优先和低资源占用的前提下，覆盖 Navicat 一类客户端最常用的数据库操作。

## 核心能力

- Windows / macOS / Linux 原生桌面端
- PostgreSQL、MySQL / MariaDB、SQLite
- 连接分组、环境标签、Read-only 模式
- 桌面端密码存入系统凭据库
- PostgreSQL Schema 发现与切换
- TLS/SSL、自定义 CA 与系统 OpenSSH 隧道
- PostgreSQL / MySQL 连接 URL 导入
- 真实对象树：表、视图、索引、触发器、序列、函数、存储过程
- Columns / PK / UNIQUE / CHECK / FK / Index 完整元数据
- 多 SQL 标签页与连接绑定
- Schema 感知 SQL 补全
- History / Scripts / Starred
- 数据分页、排序、筛选、编辑、删除、新增与安全复制
- CSV / TSV 完整导入和批量事务写入
- CSV / TSV / JSON / Markdown / SQL INSERT 导出
- 表结构编辑与 SQLite review-first rebuild
- ER 图、Schema Diff、Migration Preview
- 跨表数据搜索
- Explain / Explain Analyze 与支持引擎的查询取消
- SQLite 托管快照、完整性校验与安全恢复
- PostgreSQL / MySQL 原生备份命令生成
- Analyze / Vacuum / Optimize 数据库维护
- PROD 写操作确认、连接诊断、崩溃恢复与本地状态容量治理

## 安全模型

桌面版直接由 Rust 连接数据库，不经过 OrbitoDB 云服务，也不要求账号。

- 数据库密码使用系统凭据库
- OrbitoDB 不保存 SSH 私钥口令
- Read-only 会阻止写操作、维护操作和 Explain Analyze
- PROD 写操作需要明确确认
- Tauri WebView 启用 CSP
- Release 二进制附带 SHA-256 校验文件

### Web / Bridge 模式

浏览器无法直接连接 PostgreSQL/MySQL TCP，因此可选用本地 Node Bridge。

- SQLite 可通过 sql.js 本地运行
- PostgreSQL/MySQL 通过本地 Bridge
- Bridge 默认只监听 127.0.0.1
- 非允许 Origin 会被服务端直接拒绝
- 只接受 JSON POST，并限制请求体大小
- HTTPS/安全上下文中使用 Web Crypto 加密浏览器凭据
- 非安全 HTTP 环境不会降级为 Base64 保存，密码只保留在当前页面内存
- Docker Web UI 默认也只发布到 127.0.0.1

Web/Bridge 本身没有用户登录系统。需要远程使用时，请放到可信 VPN 或带认证的反向代理后面，不要直接暴露到公网。

## 数据库差异

### PostgreSQL
- Schema / search_path
- TLS 与 SSH
- Functions / Procedures / Sequences / Triggers
- JSON Explain / Explain Analyze
- 后端查询取消
- ANALYZE / VACUUM (ANALYZE)

### MySQL / MariaDB
- TLS 与 SSH
- Functions / Procedures / Triggers
- MySQL EXPLAIN ANALYZE / MariaDB ANALYZE FORMAT=JSON
- KILL QUERY
- ANALYZE TABLE / OPTIMIZE TABLE

### SQLite
- 本地数据库创建
- Table / View / Index / Trigger introspection
- 不支持的 ALTER 使用 review-first rebuild SQL
- EXPLAIN QUERY PLAN
- Managed snapshot、恢复前安全备份与 PRAGMA integrity_check
- ANALYZE / PRAGMA optimize / VACUUM

## 导入导出

导入支持 CSV / TSV 自动判断、引号字段、多行单元格、列映射、空字符串转 NULL、新表字段类型推断、分块批量 INSERT，以及支持事务时的失败回滚。

导出支持 CSV、TSV、JSON、Markdown、SQL INSERT。

## 发布平台

| 平台 | 产物 |
| --- | --- |
| Windows x64 | Portable EXE、NSIS 安装包 |
| macOS Apple Silicon | DMG |
| macOS Intel | DMG |
| Linux x64 | DEB、AppImage |

每个二进制产物都会同时生成 .sha256。当前 macOS CI 构建使用 ad-hoc signing；后续配置 Apple Developer 凭据后可接入正式签名与 notarization。

## 开发

需要 Node.js 24、Stable Rust，以及 Tauri 2 对应平台依赖。

    npm ci
    npm run tauri dev

完整门禁：

    npm run test:ci
    npm run check:quality
    npm run audit:security
    npm run check:bridge
    npm run check:release
    npm run build
    cargo check --manifest-path src-tauri/Cargo.toml
    cargo test --manifest-path src-tauri/Cargo.toml --lib

Docker：

    docker compose up -d

默认只监听本机。如确实需要局域网/VPN访问，再显式修改 BIND_ADDR。

## 长期运行治理

- SQL 标签页最多 24 个
- Scripts 最多 200 条
- Starred 最多 200 条
- History 最多 1000 条

应用级 Error Boundary 在 UI 异常时提供重新加载和仅重置 SQL Workspace 的恢复入口，不会删除数据库文件或连接配置。

## 项目来源

OrbitoDB 最初基于 [MamaSQL](https://github.com/fizzexual/MamaSQL) 开始开发，目前已作为独立数据库客户端持续演进。

原项目 MIT License 声明继续保留，详见 [NOTICE.md](NOTICE.md) 与 [LICENSE](LICENSE)。

## License

MIT
