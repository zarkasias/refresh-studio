export const metadata = { title: 'Projects | Site Refresh Studio' };

export default function DashboardPage() {
  return (
    <>
      <h1 className="text-3xl">Projects</h1>
      <section
        aria-labelledby="empty-title"
        className="bg-studio-surface rounded-studio mt-6 flex flex-col items-center gap-3 px-6 py-16 text-center"
      >
        <h2 id="empty-title" className="text-xl">
          No projects yet
        </h2>
        <p className="text-studio-muted-foreground max-w-md">
          Add a client&apos;s website to run an audit and see redesign options.
        </p>
        {/* Not wired up until M1, so it is aria-disabled rather than a dead link. Neutral style: cta red is only for an active primary action. */}
        <button
          type="button"
          aria-disabled="true"
          aria-describedby="new-project-note"
          className="bg-studio-background border-studio-border text-studio-muted-foreground rounded-studio mt-2 inline-flex min-h-11 min-w-44 cursor-not-allowed items-center justify-center border px-6 font-medium"
        >
          New project
        </button>
        <p id="new-project-note" className="text-studio-muted-foreground text-sm">
          Coming soon
        </p>
      </section>
    </>
  );
}
