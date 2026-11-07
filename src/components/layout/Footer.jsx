import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEnvelope } from "@fortawesome/free-solid-svg-icons";
import {
  faGithub,
  faInstagram,
  faLinkedinIn,
} from "@fortawesome/free-brands-svg-icons";

// Update these once; the footer reads everything from here.
const AUTHOR = {
  name: "Nitish Soni",
  links: [
    { label: "GitHub", icon: faGithub, href: "https://github.com/2nison6" },
    {
      label: "LinkedIn",
      icon: faLinkedinIn,
      href: "https://www.linkedin.com/in/-nitish-soni-/",
    },
    {
      label: "Instagram",
      icon: faInstagram,
      href: "https://www.instagram.com/_2nitish6_",
    },
    {
      label: "Email",
      icon: faEnvelope,
      href: "mailto:nitish.soni@2nison6.com",
    },
  ],
};

export default function Footer() {
  return (
    <footer className="site-foot">
      <div className="foot-who">
        <img
          className="foot-avatar"
          src="/images/nitish.jpg"
          alt=""
          width="36"
          height="36"
        />
        <div className="foot-text">
          <span className="foot-kicker">Designed &amp; built by</span>
          <strong className="foot-name">
            {AUTHOR.name}
            <b>.</b>
          </strong>
        </div>
      </div>
      <ul className="foot-links" aria-label={`Connect with ${AUTHOR.name}`}>
        {AUTHOR.links.map((l) => {
          const external = !l.href.startsWith("mailto:");
          return (
            <li key={l.label}>
              <a
                href={l.href}
                aria-label={l.label}
                title={l.label}
                {...(external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                <FontAwesomeIcon icon={l.icon} fixedWidth />
              </a>
            </li>
          );
        })}
      </ul>
      <p className="foot-note">
        Trace<b>Lens</b> &middot; Your files never leave this Tab &middot; &copy;{" "}
        {new Date().getFullYear()}
      </p>
    </footer>
  );
}
