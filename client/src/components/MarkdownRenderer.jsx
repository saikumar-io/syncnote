import React from 'react';
import { ExternalLink, CheckSquare, Square } from 'lucide-react';

export default function MarkdownRenderer({ content, onWikiLinkClick }) {
  if (!content) {
    return (
      <div className="markdown-preview-body empty">
        <p className="empty-text">No content in this note yet. Switch to Edit mode to write in Markdown.</p>
      </div>
    );
  }

  const lines = content.split('\n');

  // Helper to parse line text and replace [[Wiki-Links]] with interactive buttons
  const renderFormattedText = (text) => {
    const parts = [];
    const wikiLinkRegex = /\[\[(.*?)\]\]/g;
    let lastIndex = 0;
    let match;

    while ((match = wikiLinkRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(parseInlineFormatting(text.substring(lastIndex, match.index), `pre-${match.index}`));
      }

      const wikiTitle = match[1];
      parts.push(
        <button
          key={`wiki-${match.index}`}
          className="wiki-link-chip"
          onClick={(e) => {
            e.stopPropagation();
            if (onWikiLinkClick) onWikiLinkClick(wikiTitle);
          }}
          title={`Open knowledge link: ${wikiTitle}`}
          type="button"
        >
          <ExternalLink size={10} className="wiki-icon" />
          <span className="wiki-text">{wikiTitle}</span>
        </button>
      );

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push(parseInlineFormatting(text.substring(lastIndex), `post-${lastIndex}`));
    }

    return parts.length > 0 ? parts : parseInlineFormatting(text, 'line');
  };

  // Helper for inline **bold**, *italic*, `code`, #tag
  const parseInlineFormatting = (str, keyPrefix = '') => {
    let formatted = str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Bold
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong class="md-bold">$1</strong>');
    // Italic
    formatted = formatted.replace(/\*(.*?)\*/g, '<em class="md-italic">$1</em>');
    // Inline code
    formatted = formatted.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
    // Hashtags
    formatted = formatted.replace(/(^|\s)#([a-zA-Z0-9_\-]+)/g, '$1<span class="md-hashtag">#$2</span>');

    return <span key={keyPrefix} dangerouslySetInnerHTML={{ __html: formatted }} />;
  };

  let inCodeBlock = false;
  let codeBuffer = [];

  const renderedElements = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();

    // Code blocks
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        // End of code block
        renderedElements.push(
          <pre key={`code-${index}`} className="md-code-block">
            <code>{codeBuffer.join('\n')}</code>
          </pre>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Horizontal Rule
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      renderedElements.push(<hr key={index} className="md-divider" />);
      continue;
    }

    // Task List Checkboxes
    if (trimmed.startsWith('- [ ] ') || trimmed.startsWith('* [ ] ')) {
      renderedElements.push(
        <div key={index} className="md-task-item">
          <Square size={14} className="task-checkbox unchecked" />
          <span className="task-text">{renderFormattedText(trimmed.substring(6))}</span>
        </div>
      );
      continue;
    }

    if (trimmed.startsWith('- [x] ') || trimmed.startsWith('* [x] ') || trimmed.startsWith('- [X] ') || trimmed.startsWith('* [X] ')) {
      renderedElements.push(
        <div key={index} className="md-task-item checked">
          <CheckSquare size={14} className="task-checkbox checked" />
          <span className="task-text completed">{renderFormattedText(trimmed.substring(6))}</span>
        </div>
      );
      continue;
    }

    // Headings
    if (trimmed.startsWith('# ')) {
      renderedElements.push(<h1 key={index} className="md-h1">{renderFormattedText(trimmed.replace('# ', ''))}</h1>);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      renderedElements.push(<h2 key={index} className="md-h2">{renderFormattedText(trimmed.replace('## ', ''))}</h2>);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      renderedElements.push(<h3 key={index} className="md-h3">{renderFormattedText(trimmed.replace('### ', ''))}</h3>);
      continue;
    }
    if (trimmed.startsWith('#### ')) {
      renderedElements.push(<h4 key={index} className="md-h4">{renderFormattedText(trimmed.replace('#### ', ''))}</h4>);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      renderedElements.push(<blockquote key={index} className="md-quote">{renderFormattedText(trimmed.replace(/^>\s*/, ''))}</blockquote>);
      continue;
    }

    // Bullet List
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      renderedElements.push(
        <div key={index} className="md-list-item">
          <span className="bullet-dot">•</span>
          <span>{renderFormattedText(trimmed.substring(2))}</span>
        </div>
      );
      continue;
    }

    // Numbered List
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      renderedElements.push(
        <div key={index} className="md-list-item numbered">
          <span className="list-number">{numMatch[1]}.</span>
          <span>{renderFormattedText(numMatch[2])}</span>
        </div>
      );
      continue;
    }

    // Empty lines
    if (trimmed === '') {
      renderedElements.push(<div key={index} className="md-spacer" />);
      continue;
    }

    // Paragraph
    renderedElements.push(<p key={index} className="md-p">{renderFormattedText(line)}</p>);
  }

  // Handle unclosed code block
  if (inCodeBlock && codeBuffer.length > 0) {
    renderedElements.push(
      <pre key="code-unclosed" className="md-code-block">
        <code>{codeBuffer.join('\n')}</code>
      </pre>
    );
  }

  return (
    <div className="markdown-preview-body">
      {renderedElements}
    </div>
  );
}
