# __NAME__ · 模型制作

## 图片提示词

将 STYLE.md 的主体、造型、配色、材质、光线、构图与禁忌写进镜头 image_prompt。角色参考图复制到单集 assets/references 并登记 references。

## 视频提示词

video_prompt 描述人物动作、镜头运动与时间节奏。先审核分镜图，再运行 generation-plan；弹窗说明模型、数量、时长、费用和预算，用户明确确认开始后才 generation-approve。

## 制作与复用

film.json 使用 generation 配置，shots 使用 JSON。模型源素材保留在 assets/generated。具体声音、字幕、审片、交付按 director 执行。
