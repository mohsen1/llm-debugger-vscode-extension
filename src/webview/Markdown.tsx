import React from "react";
import MarkdownIt from "markdown-it";

interface MarkdownProps {
    message: string;
}

export function Markdown({ message }: MarkdownProps) {
    const md = new MarkdownIt();
    return (
        <div
            className="markdown-content"
            dangerouslySetInnerHTML={{ __html: md.render(message) }}
        />
    );
}