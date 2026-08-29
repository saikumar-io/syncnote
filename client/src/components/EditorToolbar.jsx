import React from 'react';
import { 
  Bold, 
  Italic, 
  Heading, 
  List, 
  ListOrdered, 
  Code, 
  Link as LinkIcon 
} from 'lucide-react';

export default function EditorToolbar({ onInsertSyntax }) {
  const tools = [
    { label: 'Bold (**text**)', icon: Bold, syntax: '**', type: 'wrap' },
    { label: 'Italic (*text*)', icon: Italic, syntax: '*', type: 'wrap' },
    { label: 'Heading (# Title)', icon: Heading, syntax: '# ', type: 'prefix' },
    { label: 'Bullet List (- Item)', icon: List, syntax: '- ', type: 'prefix' },
    { label: 'Numbered List (1. Item)', icon: ListOrdered, syntax: '1. ', type: 'prefix' },
    { label: 'Code Block (```)', icon: Code, syntax: '```\n', type: 'wrap' },
    { label: 'Link ([text](url))', icon: LinkIcon, syntax: '[Link Title](https://)', type: 'insert' }
  ];

  return (
    <div className="editor-toolbar">
      {tools.map((tool, idx) => {
        const IconComponent = tool.icon;
        return (
          <button
            key={idx}
            className="toolbar-btn"
            onClick={() => onInsertSyntax(tool)}
            title={tool.label}
          >
            <IconComponent size={14} />
          </button>
        );
      })}
    </div>
  );
}
