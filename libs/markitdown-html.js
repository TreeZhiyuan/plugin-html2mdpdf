(function (global) {
  'use strict';

  // Browser-side port of the HTML-specific behavior in Microsoft MarkItDown's
  // HtmlConverter and _CustomMarkdownify. Turndown remains the DOM walker;
  // these rules provide the MarkItDown-compatible decisions around HTML input.
  function quotePathPreservingPercentEncodedOctets(path) {
    return path.split('/').map(function (segment) {
      return encodeURIComponent(segment).replace(/%25([0-9A-Fa-f]{2})/g, '%$1');
    }).join('/');
  }

  function escapeLinkDestination(url) {
    return url.replace(/[()]/g, '\\$&');
  }

  function normalizeHref(rawHref) {
    if (!rawHref) return null;
    var href = rawHref.trim();
    var schemeMatch = href.match(/^([a-z][a-z0-9+.-]*):/i);
    if (schemeMatch && ['http', 'https', 'file'].indexOf(schemeMatch[1].toLowerCase()) === -1) {
      return null;
    }

    // Keep relative URLs relative, matching Python's urlparse behavior. Only
    // the path portion is quoted, so query strings and fragments remain intact.
    var suffixIndex = href.search(/[?#]/);
    var path = suffixIndex === -1 ? href : href.slice(0, suffixIndex);
    var suffix = suffixIndex === -1 ? '' : href.slice(suffixIndex);
    var prefix = '';
    if (schemeMatch) {
      prefix = schemeMatch[0];
      path = path.slice(prefix.length);
    }
    var authority = path.match(/^\/\/[^/]*/);
    if (authority) {
      prefix += authority[0];
      path = path.slice(authority[0].length);
    }
    return prefix + quotePathPreservingPercentEncodedOctets(path) + suffix;
  }

  function cleanAttribute(value) {
    return value ? value.replace(/(\n+\s*)+/g, '\n') : '';
  }

  function removeScriptsAndStyles(root) {
    root.querySelectorAll('script, style').forEach(function (element) {
      element.remove();
    });
  }

  function getConversionRoot(input) {
    if (typeof input === 'string') {
      var template = document.createElement('template');
      template.innerHTML = input;
      var body = template.content.querySelector('body');
      return body || template.content;
    }
    if (input && input.nodeType === 9) return input.body || input;
    return input;
  }

  function fallbackPlainText(root) {
    var blockNodes = root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,td,th');
    var lines = Array.from(blockNodes).map(function (node) {
      return (node.textContent || '').replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
    return (lines.length ? lines : [(root.textContent || '').replace(/\s+/g, ' ').trim()])
      .filter(Boolean).join('\n').trim();
  }

  function tableCellMarkdown(cell, options) {
    return createConverter(options).turndown(cell.innerHTML)
      .replace(/\s*\n+\s*/g, '<br>')
      .replace(/\\?\|/g, '\\|')
      .trim();
  }

  function renderTable(table, options) {
    var rows = Array.from(table.querySelectorAll('tr')).filter(function (row) {
      return row.closest('table') === table;
    });
    if (!rows.length) return '';

    // A Markdown table requires one rectangular header row. Expand HTML spans
    // into empty placeholder columns so every source cell keeps its position.
    var spans = [];
    var matrix = rows.map(function (row) {
      var occupied = new Set();
      spans.forEach(function (remaining, column) {
        if (remaining > 0) {
          occupied.add(column);
          spans[column] = remaining - 1;
        }
      });
      var values = [];
      occupied.forEach(function (column) { values[column] = ''; });
      var column = 0;
      Array.from(row.children).filter(function (cell) {
        return cell.matches('th, td');
      }).forEach(function (cell) {
        while (occupied.has(column)) column++;
        var width = Math.max(1, cell.colSpan || 1);
        var height = Math.max(1, cell.rowSpan || 1);
        values[column] = tableCellMarkdown(cell, options);
        for (var offset = 0; offset < width; offset++) {
          if (offset > 0) values[column + offset] = '';
          if (height > 1) spans[column + offset] = height - 1;
        }
        column += width;
      });
      return values;
    });

    var columnCount = Math.max.apply(null, matrix.map(function (values) { return values.length; }));
    if (!columnCount) return '';
    var formatRow = function (values) {
      return '| ' + Array.from({ length: columnCount }, function (_, index) {
        return values[index] || '';
      }).join(' | ') + ' |';
    };
    var headerCells = Array.from(rows[0].children).filter(function (cell) {
      return cell.matches('th, td');
    });
    var alignments = [];
    headerCells.forEach(function (cell) {
      var alignment = (cell.getAttribute('align') || cell.style.textAlign || '').toLowerCase();
      var marker = alignment === 'left' ? ':---' : alignment === 'right' ? '---:' : alignment === 'center' ? ':---:' : '---';
      for (var index = 0; index < Math.max(1, cell.colSpan || 1); index++) alignments.push(marker);
    });
    var separator = formatRow(Array.from({ length: columnCount }, function (_, index) {
      return alignments[index] || '---';
    }));
    var caption = table.caption ? createConverter(options).turndown(table.caption.innerHTML).trim() : '';
    var lines = [formatRow(matrix[0]), separator].concat(matrix.slice(1).map(formatRow));
    return '\n\n' + (caption ? caption + '\n\n' : '') + lines.join('\n') + '\n\n';
  }

  function wrapConversionRoot(root) {
    if (root.nodeType !== 1) return root;
    var tag = root.nodeName;
    if (tag === 'TR' || tag === 'TD' || tag === 'TH') {
      var table = document.createElement('table');
      var row = tag === 'TR' ? root : document.createElement('tr');
      if (row !== root) row.appendChild(root);
      table.appendChild(row);
      root = table;
    } else if (['THEAD', 'TBODY', 'TFOOT'].indexOf(tag) !== -1) {
      var sectionTable = document.createElement('table');
      sectionTable.appendChild(root);
      root = sectionTable;
    }
    var wrapper = document.createElement('div');
    wrapper.appendChild(root);
    return wrapper;
  }

  function createConverter(options) {
    var converter = new global.TurndownService(Object.assign({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      linkStyle: 'inlined',
      keepDataUris: false,
      blankReplacement: function (content, node) {
        if (node.nodeName === 'TABLE') return renderTable(node, options);
        return node.isBlock ? '\n\n' : '';
      }
    }, options || {}));

    converter.remove(['script', 'style']);

    converter.addRule('markitdown-heading', {
      filter: function (node) {
        return /^H[1-6]$/.test(node.nodeName);
      },
      replacement: function (content, node) {
        var text = content.trim();
        return text ? '\n' + '#'.repeat(Number(node.nodeName.slice(1))) + ' ' + text + '\n' : '';
      }
    });

    converter.addRule('markitdown-link', {
      filter: function (node) {
        return node.nodeName === 'A' && node.getAttribute('href');
      },
      replacement: function (content, node) {
        var text = content.trim();
        if (!text) return '';
        if (node.closest('pre')) return content;
        var href = normalizeHref(node.getAttribute('href'));
        if (!href) return content;
        var title = cleanAttribute(node.getAttribute('title'));
        var titlePart = title ? ' "' + title.replace(/"/g, '\\"') + '"' : '';
        return '[' + text + '](' + escapeLinkDestination(href) + titlePart + ')';
      }
    });

    converter.addRule('markitdown-image', {
      filter: 'img',
      replacement: function (content, node, ruleOptions) {
        var alt = (node.getAttribute('alt') || '').replace(/\n/g, ' ');
        var src = node.getAttribute('src') || '';
        var dataSrc = node.getAttribute('data-src') || '';
        var keepDataUris = Boolean(ruleOptions.keepDataUris);
        if (dataSrc && (!src || (/^data:/i.test(src) && !keepDataUris))) src = dataSrc;
        if (!src) return '';
        if (/^data:/i.test(src) && !keepDataUris) src = src.split(',')[0] + ',...';
        var title = cleanAttribute(node.getAttribute('title'));
        var titlePart = title ? ' "' + title.replace(/"/g, '\\"') + '"' : '';
        return '![' + alt + '](' + src + titlePart + ')';
      }
    });

    converter.addRule('markitdown-checkbox', {
      filter: function (node) {
        return node.nodeName === 'INPUT' && (node.getAttribute('type') || '').toLowerCase() === 'checkbox';
      },
      replacement: function (content, node) {
        return node.hasAttribute('checked') ? '[x] ' : '[ ] ';
      }
    });

    converter.addRule('markitdown-underline', {
      filter: 'u',
      replacement: function (content) {
        var text = content.trim();
        if (!text) return content;
        var leading = content.match(/^\s*/)[0];
        var trailing = content.match(/\s*$/)[0];
        return leading + '<u>' + text + '</u>' + trailing;
      }
    });

    converter.addRule('markitdown-strike', {
      filter: ['s', 'strike', 'del'],
      replacement: function (content) {
        var text = content.trim();
        if (!text) return content;
        var leading = content.match(/^\s*/)[0];
        var trailing = content.match(/\s*$/)[0];
        return leading + '~~' + text + '~~' + trailing;
      }
    });

    converter.addRule('markitdown-table', {
      filter: 'table',
      replacement: function (content, table) {
        return renderTable(table, options);
      }
    });

    return converter;
  }

  global.MarkItDownHtmlConverter = {
    convert: function (input, options) {
      if (!global.TurndownService) throw new Error('Turndown 库未加载');
      var originalRoot = getConversionRoot(input);
      if (!originalRoot) return '';
      var root = originalRoot.cloneNode ? originalRoot.cloneNode(true) : originalRoot;
      removeScriptsAndStyles(root);
      root = wrapConversionRoot(root);
      try {
        return createConverter(options).turndown(root).trim();
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        return fallbackPlainText(root);
      }
    },
    normalizeHref: normalizeHref
  };
})(window);
