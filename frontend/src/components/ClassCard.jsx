// Single course result card shown inside a search response bubble.
function MetaIcon({ type }) {
  if (type === 'person') {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 20c0-3.87 3.13-7 7-7s7 3.13 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'calendar') {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 10h16M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function ClassCard({ cls }) {
  const isGrad = cls.offered_to === 'G';
  const isUndergrad = cls.offered_to === 'U';
  const levelClass = isGrad ? 'class-card--graduate' : isUndergrad ? 'class-card--undergrad' : '';

  return (
    <article className={`class-card ${levelClass}`}>
      <div className="class-card-header">
        <span className="course-code">{cls.course_code}</span>
        {isGrad && <span className="level-badge level-badge--g">Graduate</span>}
        {isUndergrad && <span className="level-badge level-badge--u">Undergrad</span>}
      </div>
      <h4 className="class-title">{cls.title}</h4>
      <div className="class-meta">
        <div className="meta-row">
          <MetaIcon type="person" />
          <span>{cls.instructors || 'Instructor TBA'}</span>
        </div>
        {cls.terms_raw && (
          <div className="meta-row">
            <MetaIcon type="calendar" />
            <span>{cls.terms_raw}</span>
          </div>
        )}
        {cls.units && (
          <div className="meta-row">
            <MetaIcon type="clock" />
            <span>{cls.units}</span>
          </div>
        )}
      </div>
    </article>
  );
}
