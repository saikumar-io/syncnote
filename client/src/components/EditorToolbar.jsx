import React from 'react';
import { 
  Bold, 
  Italic, 
  Heading1, 
  Heading2,
  List, 
  ListOrdered, 
  CheckSquare,
  Code, 
  Quote,
  Link as LinkIcon,
  Tag
} from 'lucide-react';

export default function EditorToolbar({ onInsertSyntax }) {
  const tools = [
    { label: 'Bold (Ctrl+B)', icon: Bold, syntax: '**', type: 'wrap' },
    { label: 'Italic (Ctrl+I)', icon: Italic, syntax: '*', type: 'wrap' },
    { label: 'Heading 1 (#)', icon: Heading1, syntax: '# ', type: 'prefix' },
    { label: 'Heading 2 (##)', icon: Heading2, syntax: '## ', type: 'prefix' },
    { label: 'Bullet List (-)', icon: List, syntax: '- ', type: 'prefix' },
    { label: 'Numbered List (1.)', icon: ListOrdered, syntax: '1. ', type: 'prefix' },
    { label: 'Task Checkbox (- [ ])', icon: CheckSquare, syntax: '- [ ] ', type: 'prefix' },
    { label: 'Quote Block (>)', icon: Quote, syntax: '> ', type: 'prefix' },
    { label: 'Code Block (```)', icon: Code, syntax: '```\n', type: 'wrap' },
    { label: 'WikiLink ([[Note]])', icon: LinkIcon, syntax: '[[', type: 'prefix' },
    { label: 'Tag (#tag)', icon: Tag, syntax: '#', type: 'prefix' }
  ];

  return (
    <div className="editor-toolbar-dock">
      {tools.map((tool, idx) => {
        const IconComponent = tool.icon;
        return (
          <button
            key={idx}
            className="toolbar-dock-btn"
            onClick={() => onInsertSyntax(tool)}
            title={tool.label}
            type="button"
          >
            <IconComponent size={13} />
          </button>
        );
      })}
    </div>
  );
}
