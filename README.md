# LLM-Guardian

轻量级本地模型性能监控平台，前端基于 React/Vite，后端基于 FastAPI/SQLite，支持：

- 本地管理员登录
- OpenAI 兼容接口与 Ollama 主动拨测
- TTFT / TPS / E2E / 成功率采集
- 告警通道管理与事件恢复
- 实时仪表盘、日志诊断与 SLA 审计视图

## 目录结构

- `src/`: 前端控制台
- `backend/app/`: FastAPI 后端
- `backend/tests/`: 后端回归测试

## 运行前准备

前端依赖：

```bash
npm install
```

后端依赖：

```bash
pip3 install -e './backend[dev]'
```

复制环境变量模板并按需修改：

```bash
cp .env.example .env
```

至少需要设置首个管理员账号：

```env
LG_ADMIN_USERNAME=admin
LG_ADMIN_PASSWORD=change-me-now
```

## 本地开发

启动后端：

```bash
npm run dev:backend
```

启动前端：

```bash
npm run dev
```

前端默认地址：`http://127.0.0.1:3000`  
后端默认地址：`http://127.0.0.1:8000`

## 局域网访问部署

当前机器局域网 IP 示例：`192.168.1.34`

1. 安装依赖并复制环境变量：

```bash
npm install
pip3 install -e './backend[dev]'
cp .env.example .env
```

2. 在 `.env` 中至少设置管理员账号，并按需补充局域网来源：

```env
LG_ADMIN_USERNAME=admin
LG_ADMIN_PASSWORD=change-me-now
ENCRYPTION_SECRET=replace-with-a-random-secret
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:4173,http://127.0.0.1:4173,http://192.168.1.34:3000
VITE_API_BASE_URL=http://192.168.1.34:8000
```

3. 启动后端：

```bash
npm run start:backend
```

4. 构建并以局域网方式启动前端：

```bash
npm run build
npm run preview:lan
```

5. 在同一局域网其他电脑访问：

```text
http://192.168.1.34:3000
```

6. 如果其他电脑无法访问，请检查：

- 当前电脑和访问电脑在同一网段
- macOS 或系统防火墙已允许 `python3` 和 `node` 接收传入连接
- 路由器或安全软件没有拦截 `3000`、`8000` 端口

## 开发模式下的局域网访问

如果你希望继续使用 Vite 热更新，而不是构建后预览：

1. 启动后端：

```bash
npm run dev:backend
```

2. 启动前端：

```bash
BACKEND_URL=http://192.168.1.34:8000 npm run dev
```

3. 其他局域网电脑访问：

```text
http://192.168.1.34:3000
```

## 校验

TypeScript 检查：

```bash
npm run lint
```

前端构建：

```bash
npm run build
```

后端测试：

```bash
python3 -m pytest backend/tests
```
