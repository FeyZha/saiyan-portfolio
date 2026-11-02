# 本地产品与演示运行

## 固定内容成品

在仓库根目录运行 `npm run preview`，打开 http://127.0.0.1:3201/ 。不需要安装业务依赖或模型。使用其他端口时执行 `node demo/scripts/preview.mjs 3201`。

## 实际产品源码

源码沿用当前本机产品的目录结构。需要 Node.js 24+、Python 和各依赖包支持的系统环境。在 `product/` 运行 `npm run setup`，再运行 `npm run dev`，竞赛页面监听 http://127.0.0.1:3190/competitions 。只开启竞赛工作台也可使用 `npm run dev:competitions`（3187端口）。

正式竞赛资料、个人会话、画布及授权文件未分发；启动后是新的本机工作区，不会恢复作者的资料库。真实竞赛问答、资料处理与创作需要自行配置产品所支持的模型登录，执行模型任务可能消耗自己的额度。不要将该单用户服务直接暴露到公网。

ComfyArt 接入需要自行安装兼容 ComfyUI 并准备 Python 环境。Windows 下通过环境变量 `SAIYAN_COMFYUI_ROOT` 与 `SAIYAN_PYTHON`，或 `product/scripts/start-comfyart.ps1` 的同名参数指定；不包含作者本机路径或模型权重。画布库自身的许可要求仍然适用。

`product/platform/comfyart/LICENSE` 与 `demo/licenses/` 保留上游版权。竞赛事实使用内置来源链接，固定业务日期只用于复现演示；实际投稿请重新核对官方公告。

本次发布核验范围在根目录 README 中说明；完整本机模型与 ComfyUI 链路需配置后单独验收。
