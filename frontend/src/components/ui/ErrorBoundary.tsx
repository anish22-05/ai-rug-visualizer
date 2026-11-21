import { Component, type ReactNode } from 'react'

/** Keeps a rendering bug in one area from taking down the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.label}]`, error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="stage-message">
          <strong>Something went wrong in the {this.props.label}.</strong>
          <button className="btn small" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
