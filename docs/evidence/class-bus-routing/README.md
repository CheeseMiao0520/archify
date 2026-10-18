# 类图主干与组外路由协调：#791 证据

## 空 via 审查跟进

CodeRabbit 在 `b17b5171` 指出合法的 `via: []` 在主干回退后会被普通路由器误认为显式路径。
Class 关系入口现在只克隆并移除空数组字段，统一主干与普通路由的判断；非空路径及其他控制原样保留，不改写原始输入。

- 新增 7 项回归在修复前为 5 失败／2 通过；修复后连同原套件共 **41 项通过，0 失败，0 跳过**。
- 覆盖一条、主干成员、全部关系带空 via，standard/showcase 以及原序／逆序，验证与省略 via 的 SVG 相同；显式侧边、straight、labelAt 和非空 via 保留。
- Chrome 场景改为实际携带空 via；**2 项真实浏览器检查通过**，包含 light/dark 的 Focus 和独立 SVG 导出。generated 检查通过。
- 原 18 个固定输入重新运行公开 validate/render/check，完整 HTML 均与前一候选逐字节一致，见 [empty-via-followup.json](empty-via-followup.json)。因此复用下方原有截图和视觉观察，保留原修订归属，不重新标注为本轮截图。
- 新 ZIP 为 149 文件，两次构建一致，仓库外解包 smoke 通过；SHA-256：`1a3cb744929202d3fbfac0a3666a140073477746c56a3beacbf43ff7aa0b62c9`。

## 初版版本和观察范围

比较基线：`9ef09617bd9ed2fe7bb4ad17fba7c8fce6b0ce76`。
候选运行时的 SHA-256、输入和输出摘要见 [comparison.json](comparison.json)；提交前以相同运行时代码采集。环境为 macOS 15.7.7、官方 Node 22.23.1、Chrome 154.0.8037.98。

核心修复位于 Class renderer。共享 Router、其他 renderer、schema 和发布身份未修改。规格与边界见[验收规格](../../specs/class-bus-routing-validation.md)。

## 已复现并修复的行为

- 四类型、三关系：继承主干和普通 realization/dependency 共享目标中心。依赖的开放箭头被继承三角覆盖；修复后使用不同端口。
- 两种 hierarchy bus：继承和实现仍共享实线主干；冲突后两组均回退，保留各自线型。
- 等高交错排列：只移除主干仍会让普通路线共享 115px 走廊；回退后开启已有独立端口模式，修复该边界。
- 已有 shapes 案例：继承主干的横段与 Group → Shape 的组合关系在 `(593,206)` 交叉。修复后取消该主干并重排自动关系；节点和成员文本不变。

## 初版验证结果

| 检查 | 结果 |
| --- | --- |
| 新旧 Class 专项 | 34 通过，0 失败，0 跳过 |
| 核心产品 smoke（npm test） | 18 通过，0 失败，0 跳过 |
| Class 真实 Chrome | 2 通过，0 失败，0 跳过 |
| generated 检查 | 通过，包括现有样例与权威源一致性 |
| 固定输入前后比较 | 18/18 均 validate/render/check 成功 |
| 完整 HTML/SVG 不变 | 13 个：4 个 Class 控制及其余 9 类图 |
| 预期改变 | 4 个复现、1 个已有 shapes 案例 |
| Class 图事实与类型布局 | 9/9 的类型位置、尺寸、文字及关系身份／种类不变 |

TDD 原始版本的 6 项核心回归失败；第一版局部回退又被 2 项等高交错回归阻止，最终 15 项新增 Class 回归全部通过。关系顺序、同类主干、独立主干、显式几何、路径有限性和画布范围均由行为测试覆盖。

浏览器测试真实执行 Focus 和 SVG 序列化，只截取下载边界；light/dark 中验证路径与标记保留。原有同类主干检查继续验证移动 token、聚焦脉冲及 WebM 采样的语义方向。

没有运行本地完整 test:full。最终远端 CI 的修订与结果记录在 PR，不将本地或历史结果冒充新的远端运行。

## 前后截图

统一使用 1440×900、Classic、100% zoom、页面顶部、字体与布局稳定后的状态。以下 12 张截图均已实际目视检查：依赖箭头与继承三角可区分，交错关系保留线型，节点、成员及标签无新增裁切或遮挡。观察只覆盖这些案例。

| 案例与主题 | 基线 | 修复后 |
| --- | --- | --- |
| 依赖 / light | [前](bus-with-dependency-before-light.png) | [后](bus-with-dependency-after-light.png) |
| 依赖 / dark | [前](bus-with-dependency-before-dark.png) | [后](bus-with-dependency-after-dark.png) |
| 等高交错 / light | [前](interleaved-before-light.png) | [后](interleaved-after-light.png) |
| 等高交错 / dark | [前](interleaved-before-dark.png) | [后](interleaved-after-dark.png) |
| Shapes / light | [前](first-draft-shapes-before-light.png) | [后](first-draft-shapes-after-light.png) |
| Shapes / dark | [前](first-draft-shapes-before-dark.png) | [后](first-draft-shapes-after-dark.png) |

对比记录中的单次 render 耗时仅是诊断样本，部分采集时有专项测试并行执行，不作为性能提升或无回退的基准证明。

## 复现

在基线或候选 checkout 的根目录，使用本目录中的同一输入：

```sh
node archify/bin/archify.mjs validate class docs/evidence/class-bus-routing/fixtures/bus-with-dependency.class.json --quality showcase --json
node archify/bin/archify.mjs render class docs/evidence/class-bus-routing/fixtures/bus-with-dependency.class.json /tmp/class-bus-review.html --quality showcase
node archify/bin/archify.mjs check /tmp/class-bus-review.html --json
```

基线 checkout 没有此目录时，先将候选的 fixtures 复制到单独目录，并在上述命令中使用该目录的绝对输入路径。其余复现为 `bus-with-ordinary.class.json`、`mixedbus.class.json`、`interleaved.class.json`；Shapes 使用仓库已有的 `test/fixtures/class-first-draft/shapes.class.json`。

```sh
npm ci
npm --prefix archify ci
npm run test:focus -- test/class-bus-routing.test.mjs test/class-rendering.test.mjs test/class-first-draft-layout.test.mjs
npm test
npm run test:generated
ARCHIFY_CHROME="/path/to/chrome" npm run test:browser -- test/class-motion-browser.test.mjs
scripts/build-zip.sh /tmp/class-bus-archify.zip
node scripts/package-smoke.mjs /path/to/extracted/archify
```

两次 canonical ZIP 构建逐字节一致，149 个文件。SHA-256：`fc4cc8d7e88a6532ab110d39104994f70f91ccb6bef6a1c05ceb74fd95e2a2ef`。解包 smoke 在仓库外、无已安装包依赖的环境下验证，结果见 PR；未进行 live Skill 安装、发布或部署。
