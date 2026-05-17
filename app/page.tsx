import { Dropzone } from "@/components/Intake/Dropzone";

export default function Page() {
  return (
    <main className="landing landing-v2">
      <header className="landing-hd landing-hd-v2">
        <div className="brand-row">
          <img src="/crovi-logo.svg" alt="" className="brand-logo" />
          <span className="serif brand-word">Crovi</span>
        </div>
        <span className="mono-sm landing-eyebrow">vCRO · biospecimen sourcing</span>
      </header>

      <section className="landing-stage">
        <div className="landing-pitch">
          <h1 className="serif landing-headline">
            Drop the intake PDF.<br />
            Watch agents close it.
          </h1>
          <p className="landing-sub">
            We read your 35-field request, surface the suppliers worth talking to,
            and run the contact, scheduling and contract loop end-to-end.
          </p>
        </div>
        <Dropzone />
      </section>

      <footer className="landing-foot">
        <span className="mono-sm">Powered by</span>
        <span className="landing-foot-list mono-sm">
          Browser Use · AgentPhone · AgentMail · Sponge · Supermemory · Moss
        </span>
      </footer>
    </main>
  );
}
