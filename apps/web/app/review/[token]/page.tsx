export const metadata = {
  title: 'Website preview | Chambers Consulting',
  robots: { index: false, follow: false }, // private share link
};

// TODO(rule 4): once review links are real, validate the token and gate the variant with
// assertShareable (packages/site-model guards) so nothing without `approvedAt` is shown.
//
// M2 NOTE: the variant canvas will render inside an <iframe> so studio CSS never reaches
// client previews, and the client's design tokens from packages/sections apply only inside
// that iframe. Do not render any client-looking design in this page's own DOM.
export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  await params; // Token is not validated yet.
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section aria-labelledby="preview-title">
        <h1 id="preview-title" className="text-2xl">
          Design preview
        </h1>
        <div className="bg-studio-surface border-studio-border rounded-studio mt-4 flex min-h-96 items-center justify-center border border-dashed p-6 text-center">
          <p className="text-studio-muted-foreground">The design preview will appear here.</p>
        </div>
      </section>
      <aside
        aria-labelledby="comments-title"
        className="border-studio-border rounded-studio border p-4"
      >
        <h2 id="comments-title" className="text-lg">
          Comments
        </h2>
        <p className="text-studio-muted-foreground mt-2">Comments will appear here</p>
      </aside>
    </div>
  );
}
