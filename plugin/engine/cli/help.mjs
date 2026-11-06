// 原命令帮助正文；不再通过读取入口源文件生成。
export const HELP = `wkd —— wukong-drama 引擎命令行。
  wkd settings-init <片目录>         给旧片补三类设定清单（不覆盖）
  wkd settings-save <项目目录> --file 设定.json   新建角色／道具／场景版本
  wkd settings-review <片目录>       生成集中审查材料、当前签名与受影响镜头
  wkd settings-reuse <片目录> --signature 摘要   沿用全部已有同风格批准的设定
  wkd image-plan <片目录> [--host 能力.json] [--batch 批次.json] [--only s01,s03] [--aspect 9:16]   本批图片来源、数量、费用与推荐
  wkd image-approve <片目录> --method host|api --signature 摘要 --source "本批实际选择"   选择与授权合并；保持同批 host/batch/only/aspect
  wkd image-dispatch <片目录> --method host|api [--item 编号]   执行 API 或交接一个宿主任务；保持同批参数
  wkd image-import <片目录> --method host --item 编号 --signature 摘要 --file 实际图片 --source "结果来源"   验证并回收；保持同批参数
  wkd generation-plan <片目录> --kind video [--aspect 16:9] [--only s01,s03]   离线列出批次、预算与输入签名
  wkd generation-approve <片目录> --kind video [--only s01,s03] --source "用户实际批准来源"   需 --signature <计划签名>；图片用 image-approve
  wkd series-init <项目目录> --name 剧集名 [--entry idea|script|storyboard]
  wkd series <项目目录>              读取角色版本、草稿与正式连续性
  wkd series-update <项目目录> --action character|approve-character|draft|confirm-episode --file 输入.json [--source 来源] [--signature 摘要]
  wkd setup                         按锁文件安装依赖到用户目录（按版本和环境隔离）
  wkd check                         检查环境与所有插槽
  wkd list [styles|pipelines|exporters]
  wkd init-project [目录]           git 初始化工程（第 1 道工序）
  wkd brief <片名> [--dir 项目目录]  建占位片目录和简报空白稿（第 2 道工序）
  wkd init <片名> --style <id> [--dir 项目目录] [--aspect 16:9|9:16]
  wkd new style <id> --name 名称 [--category 分类] [--order N] [--dest 目录]   新建风格（默认 ~/.wukong-drama/styles/）
  wkd status [项目目录]             各片制作进度（恢复在制项目）
  wkd resume <片目录> [--json]       核实已完成产物、失败阶段和待存档签批
  wkd delivery <片目录> --host codex|claude|generic [--aspect all|9:16] [--json]  生成存在性与新旧状态交付清单
  wkd signoff <片目录> "<审片结论>" [--step N] [--settings-signature 摘要]   第 5 道绑定设定审查，其他审片节点签批：记录进度并做定版快照
  wkd qc <片目录> [--proxy] [--aspect 9:16]       量化技术质检（QC）
  wkd still <片目录> [--frames N] [--at s02:1.5,s03:2] [--proxy] [--aspect 9:16]   静帧 + 接触表
  wkd animatic <片目录> [--proxy] [--aspect 9:16]   动态分镜：代表帧按镜头时长排成粗片并配上声轨
  wkd render <片目录> [--proxy] [--only s01,s03] [--force] [--aspect 9:16]   渲染（--proxy 为小样；--aspect 出副版）
  wkd preview <片目录> [--only s01,s03] [--native] [--force] [--aspect 9:16]   日常局部小样（--native 原画质与原帧率）
  wkd clean <片目录> --render-cache [--aspect 9:16]   主动清理当前画幅的可再生渲染缓存
  wkd soundtrack <片目录>           声轨制作：配乐 + 人声，写入声音同步点（不要求镜头文件已写好）
  wkd sfx <片目录> [--list]         录音音效：--list 只列来源与大小（给用户确认），不带参数则下载并处理
  wkd audition <片目录> [--voices a,b,c] [--text "…"] [--rate -20%] [--pitch -2Hz]   音色试听：同一句用几个音色各合成一遍
  wkd subtitles <片目录> [--force] [--preview|--preflight] [--aspect 9:16]   字幕制作：从人声生成 subtitles.srt；--preflight 预检（还没有小样时为版式预检）；--preview 烧录到小样上审阅
  wkd final <片目录> [--proxy] [--only ...] [--formats mp4,gif] [--aspect 9:16|all]   终版渲染与终混`;
