// Converts stored UI messages into the { role, text } shape the backend expects.
export function buildHistory(messages, limit = 6) {
  return messages
    .slice(-limit)
    .map((m) => {
      if (m.role === 'user') {
        return { role: 'user', text: m.text };
      }
      if (m.kind === 'chat') {
        return { role: 'assistant', text: m.text };
      }
      if (m.kind === 'search') {
        const count = m.count ?? m.results?.length ?? 0;
        const filters = m.filters
          ? Object.entries(m.filters)
              .filter(([, v]) => v)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')
          : '';
        const courseSummary = (m.results || [])
          .map((c) => `${c.course_code} (${c.offered_to === 'G' ? 'grad' : 'undergrad'}): ${c.title}`)
          .join('; ');
        const summary = filters
          ? `Found ${count} classes (${filters}).${courseSummary ? ` Courses: ${courseSummary}.` : ''}`
          : courseSummary
            ? `Found ${count} matching classes. Courses: ${courseSummary}.`
            : `Found ${count} matching classes.`;
        return { role: 'assistant', text: summary };
      }
      if (m.error) {
        return { role: 'assistant', text: m.error };
      }
      return { role: 'assistant', text: '' };
    })
    .filter((m) => m.text);
}
