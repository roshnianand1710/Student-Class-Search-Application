// Full-screen entry screen — galaxy backdrop with CourseCompass branding.
export default function LandingPage({ onEnter, exiting, onTransitionEnd }) {
  return (
    <button
      type="button"
      className={`landing-page${exiting ? ' landing-page-exiting' : ''}`}
      onClick={onEnter}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget) onTransitionEnd?.(e);
      }}
      aria-label="Enter Course Compass"
    >
      <div className="landing-content">
        <div className="landing-logo" aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M12 3v4M12 17v4M3 12h4M17 12h4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle cx="12" cy="12" r="2.5" fill="currentColor" />
          </svg>
        </div>

        <h1 className="landing-title">
          <span className="landing-title-line">Course</span>
          <span className="landing-title-line landing-title-line-accent">Compass</span>
        </h1>

        <p className="landing-tagline">MIT EECS Class Search</p>
        <p className="landing-hint">Click anywhere to explore</p>
      </div>
    </button>
  );
}
