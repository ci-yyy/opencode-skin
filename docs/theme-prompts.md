# 主题背景图生成提示词库

自制主题没有现成图片时，用这些提示词生图（任何生图工具都行）。生成后：

```bash
node create-theme.mjs --image 生成的图.png --name "主题名"
```

自动完成取色、深浅判定、可读性校正、语义配色生成。

通用要求（每条提示词都自带）：1920×1080 以上、构图留出左侧 1/3 给侧栏（深色区域）、
主体放右侧、整体色调统一、无文字无水印。

---

## 1. 深空紫（赛博感）

> A moody cyberpunk cityscape at night, deep purple and violet tones, neon signs glowing softly in the rain, left third of the image fading into dark shadows, main visual weight on the right side, cinematic lighting, ultra detailed, no text, 1920x1080

## 2. 晨雾森林（浅色）

> Soft morning mist over a lush green forest, pale golden sunlight filtering through leaves, airy light composition, left side gentle gradient into soft white, right side a towering ancient tree, watercolor style, pastel greens and cream, no text, 1920x1080

## 3. 星夜海岸（深蓝）

> A calm ocean under a starry night sky, milky way reflected on dark water, deep navy and indigo palette with faint teal accents, left horizon dark and minimal, right side dramatic cliffs silhouette, long exposure style, no text, 1920x1080

## 4. 落日熔金（暖色）

> Golden sunset over rolling hills, warm amber and burnt orange sky, silhouetted lone tree on the right, left side soft dusk gradient, painterly style, rich warm tones, no text, 1920x1080

## 5. 樱雪粉青

> Cherry blossom petals drifting in a spring breeze, soft pink and teal color scheme, dreamy bokeh, left side minimal gradient, right side a blooming sakura branch, anime aesthetic, gentle lighting, no text, 1920x1080

## 6. 雨夜霓虹

> Rain-soaked city street at night, reflections of pink and cyan neon lights on wet asphalt, moody atmosphere, left side dark alley fading, right side glowing storefront, cinematic composition, no text, 1920x1080

## 7. 极简墨色（纯深色底）

> Minimalist dark abstract background, subtle ink brush texture, deep charcoal black with faint blue-grey gradient, extreme simplicity, left side pure dark, right side a single elegant brush stroke, zen aesthetic, no text, 1920x1080

## 8. 纸上云山（纯浅色底）

> Minimalist light background, soft ink wash painting of distant mountains, cream and pale grey palette, vast negative space, small mountain silhouette on the right third, traditional East Asian aesthetic, no text, 1920x1080
