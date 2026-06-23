-- Postgres schema for MIT Course 6 class search (run before npm run ingest).
DROP TABLE IF EXISTS classes;
DROP TABLE IF EXISTS instructors;
DROP TABLE IF EXISTS subjects;
DROP TABLE IF EXISTS class_instructors;

-- Department codes, e.g. "6" for EECS.
CREATE TABLE subjects (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE   -- e.g. "6" (MIT EECS department number)
);

-- One row per distinct instructor name from the CSV.
CREATE TABLE instructors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- Core class catalog row — one per course offering entry.
CREATE TABLE classes (
  id SERIAL PRIMARY KEY,
  subject_id INT REFERENCES subjects(id),
  course_code TEXT,           -- e.g. "6.1010"
  title TEXT,
  description TEXT,
  prereq TEXT,
  terms_raw TEXT,              -- original messy text, e.g. "U (Fall, Spring)"
  level TEXT,                  -- e.g. "intro", "1000", "5000" -- derived, see below
  units TEXT,                  -- e.g. "2-0-4 units"
  offered_to TEXT,             -- 'U' or 'G'
  has_fall BOOLEAN DEFAULT FALSE,
  has_spring BOOLEAN DEFAULT FALSE,
  has_iap BOOLEAN DEFAULT FALSE,
  has_summer BOOLEAN DEFAULT FALSE
);

-- Many-to-many: a class can have multiple instructors.
CREATE TABLE class_instructors (
  class_id INT REFERENCES classes(id),
  instructor_id INT REFERENCES instructors(id),
  PRIMARY KEY (class_id, instructor_id)
);

-- Indexes speed up common filter columns used in searchClasses().
CREATE INDEX idx_classes_subject ON classes(subject_id);
CREATE INDEX idx_classes_offered_to ON classes(offered_to);
CREATE INDEX idx_classes_terms ON classes(has_fall, has_spring, has_iap, has_summer);
