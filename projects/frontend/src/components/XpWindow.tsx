import { ReactNode } from 'react'

interface XpWindowProps {
  title: string
  children: ReactNode
  onClose?: () => void
  showControls?: boolean
  className?: string
}

const XpWindow = ({ title, children, onClose, showControls = true, className = '' }: XpWindowProps) => {
  return (
    <div className={`xp-window ${className}`}>
      <div className="xp-titlebar">
        <span className="xp-titlebar-text">{title}</span>
        {showControls && (
          <div className="flex items-center">
            <button className="xp-title-btn" aria-label="Minimize">_</button>
            <button className="xp-title-btn" aria-label="Maximize">&#9633;</button>
            <button
              className="xp-title-btn xp-title-btn-close"
              aria-label="Close"
              onClick={onClose}
            >
              X
            </button>
          </div>
        )}
      </div>
      <div className="xp-window-body">{children}</div>
    </div>
  )
}

export default XpWindow
