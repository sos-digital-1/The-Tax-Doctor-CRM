import Apps from "../components/Apps";
import { PageHead } from "../ui";

/** Open to every signed-in team member. */
export default function AppsPage() {
  return (
    <>
      <PageHead title="Get the apps" sub="Install Tax Doctor on your phone and your Windows PC - same account, same data, with alerts for tickets and chat." />
      <Apps />
      <div className="card card-b small muted" style={{ marginTop: 14 }}>
        <b style={{ color: "var(--text)" }}>Prefer no download?</b> On Android, open <b>crm.thetaxdoctor.in</b> in Chrome, tap the menu and choose “Install app”. On a PC, use the install icon at the right of Chrome's address bar.
      </div>
    </>
  );
}
