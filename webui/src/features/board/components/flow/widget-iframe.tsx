import { memo } from "react"


type WidgetIframeProps = {
  html: string
  className?: string
  title?: string
}


const WIDGET_BASE_STYLE = `
  <style>
    html, body, * {
      scrollbar-width: thin;
      scrollbar-color: transparent transparent;
    }

    html:hover, body:hover, *:hover {
      scrollbar-color: rgba(120,120,130,.5) transparent;
    }

    ::-webkit-scrollbar {
      width: 4px;
      height: 4px;
      background: transparent !important;
    }

    ::-webkit-scrollbar-track {
      background: transparent !important;
    }

    ::-webkit-scrollbar-thumb {
      background-color: rgba(120,120,130,.5);
      border-radius: 999px;
      opacity: 0;
      transition: opacity .2s ease, background-color .2s ease;
    }

    html:hover::-webkit-scrollbar-thumb,
    body:hover::-webkit-scrollbar-thumb,
    *:hover::-webkit-scrollbar-thumb {
      opacity: 1;
    }

    html:hover::-webkit-scrollbar-thumb:hover,
    body:hover::-webkit-scrollbar-thumb:hover,
    *:hover::-webkit-scrollbar-thumb:hover {
      background-color: rgba(120,120,130,.7);
    }

    ::-webkit-scrollbar-corner {
      background: transparent !important;
    }
  </style>
`


/**
 * Prepends shared iframe styles to widget HTML before rendering.
 */
const buildWidgetDocument = (html: string) => `${WIDGET_BASE_STYLE}\n${html}`


/**
 * Render widget HTML in a sandboxed iframe using srcDoc.
 */
export const WidgetIframe = memo(function WidgetIframe({
  html,
  className,
  title = "Widget preview",
}: WidgetIframeProps) {
  return (
    <iframe
      title={title}
      srcDoc={buildWidgetDocument(html)}
      sandbox="allow-scripts"
      loading="lazy"
      referrerPolicy="no-referrer"
      className={className}
    />
  )
})
