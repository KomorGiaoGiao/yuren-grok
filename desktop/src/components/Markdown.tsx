import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

function closeOpenFences(text: string): string {
  const fences = text.match(/```/g)?.length ?? 0;
  return fences % 2 === 1 ? `${text}\n\`\`\`` : text;
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const child = Children.toArray(children).find((node) => isValidElement(node));
  const className =
    child && isValidElement<{ className?: string }>(child) ? child.props.className || "" : "";
  const lang = /language-([\w+-]+)/.exec(className)?.[1] || "";
  return (
    <div className="code-block">
      {lang ? <div className="code-lang">{lang}</div> : null}
      <pre>{children}</pre>
    </div>
  );
}

export function Markdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <div className={`markdown${streaming ? " is-streaming" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true }]]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          code: ({ className, children, ...props }) =>
            className ? (
              <code className={className} {...props}>
                {children}
              </code>
            ) : (
              <code className="md-inline-code" {...props}>
                {children}
              </code>
            ),
        }}
      >
        {closeOpenFences(text)}
      </ReactMarkdown>
      {streaming ? <span className="stream-caret" aria-hidden /> : null}
    </div>
  );
}
