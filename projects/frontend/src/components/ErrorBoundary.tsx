import React, { ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error: error }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen flex items-center justify-center p-8"
          style={{ backgroundColor: '#000080' }}
        >
          <div className="max-w-2xl" style={{ fontFamily: '"Lucida Console", "Courier New", monospace', color: '#fff' }}>
            <p className="text-lg mb-6">
              A problem has been detected and Campus SuperApp has been shut down to prevent damage to your blockchain.
            </p>
            <p className="mb-4 text-sm">
              CRITICAL_PROCESS_DIED
            </p>
            <p className="mb-6 text-sm">
              {this.state.error?.message.includes('Attempt to get default algod configuration')
                ? 'Please make sure to set up your environment variables correctly. Create a .env file based on .env.template and fill in the required values. This controls the network and credentials for connections with Algod and Indexer.'
                : this.state.error?.message}
            </p>
            <p className="text-sm mb-4">
              Technical information:
            </p>
            <p className="text-sm mb-6">
              *** STOP: 0x000000EF (0x00000000, 0x00000000, 0x00000000, 0x00000000)
            </p>
            <p className="text-sm">
              Press any key to restart, or refresh the page to try again.
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
