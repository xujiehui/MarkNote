import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Do not include stack traces or exception messages that may contain notes.
    console.error('MarkNote could not render the application.', { name: error.name });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const zh = navigator.language.toLowerCase().startsWith('zh');
    return (
      <main role="alert" className="flex min-h-screen items-center justify-center bg-[#fbfaf7] p-6 text-[#34302b]">
        <div className="max-w-md space-y-4">
          <h1 className="text-xl font-semibold">{zh ? '应用暂时无法显示' : 'The application could not open'}</h1>
          <p>{zh ? '已保存的本地笔记仍保留在此设备。请尝试重新打开应用；如果问题持续，请联系项目支持。' : 'Saved local notes remain on this device. Try reopening the app. If the problem continues, contact project support.'}</p>
          <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-[#34302b] px-4 py-2 text-white">
            {zh ? '重新打开应用' : 'Reopen application'}
          </button>
        </div>
      </main>
    );
  }
}
