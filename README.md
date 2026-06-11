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
