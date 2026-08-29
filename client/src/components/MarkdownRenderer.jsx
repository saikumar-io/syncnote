import React from 'react';

export default function MarkdownRenderer({ content, onWikiLinkClick }) {
  if (!content) return <div className="markdown-preview-body" style={{ color: 'var(--text-muted)' }}>Empty note</div>;

  const lines = content.split('\n');

  // Helper to parse line text and replace [[Wiki-Links]] with interactive buttons
  const renderFormattedText = (text) => {
    const parts = [];
    const wikiLinkRegex = /\[\[(.*?)\]\]/g;
    let lastIndex = 0;
    let match;

    while ((match = wikiLinkRegex.exec(text)) !== null) {
      // Text before link
      if (match.index > lastIndex) {
        parts.push(parseInlineFormatting(text.substring(lastIndex, match.index)));
      }

      const wikiTitle = match[1];
      parts.push(
        <button
          key={`wiki-${match.index}`}
          className="wiki-link-badge"
          onClick={(e) => {
            e.stopPropagation();
            if (onWikiLinkClick) onWikiLinkClick(wikiTitle);
          }}
          title={`Click to open or create note "${wikiTitle}"`}
        >
          [[{wikiTitle}]]
        </button>
      );

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push(parseInlineFormatting(text.substring(lastIndex)));
    }

    return parts.length > 0 ? parts : parseInlineFormatting(text);
  };

  // Helper for inline **bold**, *italic*, `code`
  const parseInlineFormatting = (str) => {
    // Bold
    let formatted = str.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italic
    formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Inline code
    formatted = formatted.replace(/`(.*?)`/g, '<code class="md-inline-code">$1</code>');

    return <span key={Math.random()} dangerouslySetInnerHTML={{ __html: formatted }} />;
  };

  return (
    <div className="markdown-preview-body">
      {lines.map((line, index) => {
        const trimmed = line.trim();

        if (trimmed.startsWith('# ')) {
          return <h1 key={index} className="md-h1">{renderFormattedText(trimmed.replace('# ', ''))}</h1>;
        }
        if (trimmed.startsWith('## ')) {
          return <h2 key={index} className="md-h2">{renderFormattedText(trimmed.replace('## ', ''))}</h2>;
        }
        if (trimmed.startsWith('### ')) {
          return <h3 key={index} className="md-h3">{renderFormattedText(trimmed.replace('### ', ''))}</h3>;
        }
        if (trimmed.startsWith('> ')) {
          return <blockquote key={index} className="md-quote">{renderFormattedText(trimmed.replace('> ', ''))}</blockquote>;
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return <div key={index} className="md-list-item">• {renderFormattedText(trimmed.substring(2))}</div>;
        }
        if (trimmed.startsWith('```')) {
          return <div key={index} className="md-code-block">{trimmed}</div>;
        }
        if (trimmed === '') {
          return <div key={index} style={{ height: '8px' }} />;
        }

        return <p key={index} className="md-p">{renderFormattedText(line)}</p>;
      })}
    </div>
  );
}
