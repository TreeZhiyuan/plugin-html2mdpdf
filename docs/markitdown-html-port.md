# MarkItDown HTML 转 Markdown 逻辑移植说明

本项目参考 Microsoft MarkItDown 当前 `main` 分支中的两个实现文件：

- `packages/markitdown/src/markitdown/converters/_html_converter.py`
- `packages/markitdown/src/markitdown/converters/_markdownify.py`

## 原项目逻辑

`HtmlConverter.convert()` 负责输入边界和页面清洗：解析 HTML，移除 `script` 与 `style`，优先取 `body`，然后交给自定义 Markdown 转换器；当递归遍历过深时，回退为按块提取纯文本。`convert_string()` 只是把字符串包装成 HTML 流后复用同一条路径。

`_CustomMarkdownify` 在基础 `markdownify` 之上覆盖了这些规则：

- 标题使用 ATX 风格，并确保标题前有换行。
- 链接只保留 `http`、`https`、`file` 和相对 URL；其他协议（例如 `javascript:`）降级为链接文本。URL 路径会转义空格等字符，同时保留已有 `%HH` 编码。
- 图片优先读取可用的 `data-src`；默认截断大型 Data URI，避免 Markdown 文件膨胀。
- 复选框转换为 `[x]` 或 `[ ]`。
- `<u>` 保留为 HTML 下划线；`<s>`、`<strike>`、`<del>` 使用删除线。

## 浏览器端移植

`libs/markitdown-html.js` 复用了项目已有的 Turndown DOM 遍历器，并把上面的 MarkItDown 决策实现为高优先级自定义规则。列表、代码块、引用和换行沿用 Turndown；表格增加单独的 GFM 表格规则。

表格规则识别 `table` 内的 `thead`、`tbody`、`tfoot`、`tr`、`th` 和 `td`，输出表头、分隔行和数据行。直接选中 `table` 或其表格子节点时，会先包装成可遍历的表格根节点。空单元格也会保留；`colspan` 和 `rowspan` 会展开为空白占位列，以保持列位置。Markdown 表格无法原样表示合并单元格，因此合并效果本身不会保留。单元格中的行内格式、链接和换行会继续转换，并对竖线转义。

内容脚本的导出流程现在是：

1. 对每个选中的导出区域复制 DOM。
2. 移除插件自身标记和已隐藏节点。
3. 由 `MarkItDownHtmlConverter` 移除 `script/style`，安装 MarkItDown 规则并转换。
4. 将多个区域的 Markdown 以空行连接后下载。

插件使用的是浏览器 JavaScript，因此没有直接搬入 BeautifulSoup、Python `markdownify` 或 Python 递归异常处理；对应行为分别由 DOM API、Turndown 自定义规则和 `RangeError` 文本回退实现。
