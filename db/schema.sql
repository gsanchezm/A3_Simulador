CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
  approved boolean NOT NULL DEFAULT false,
  student_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY,
  teacher_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  university text NOT NULL,
  subject text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS groups_teacher_idx ON groups(teacher_id);

CREATE TABLE IF NOT EXISTS memberships (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, student_id)
);
CREATE INDEX IF NOT EXISTS memberships_student_idx ON memberships(student_id);

CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  max_uses integer NOT NULL CHECK (max_uses > 0),
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invitations_group_idx ON invitations(group_id);

CREATE TABLE IF NOT EXISTS attempts (
  id text PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  chapter integer NOT NULL CHECK (chapter > 0),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  duration integer NOT NULL CHECK (duration >= 0),
  answers jsonb NOT NULL,
  detail jsonb NOT NULL,
  score integer NOT NULL,
  total integer NOT NULL,
  pct numeric(6,2) NOT NULL,
  hash text NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_student_group_idx ON attempts(student_id, group_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS attempts_group_student_idx ON attempts(group_id, student_id, finished_at DESC);

CREATE TABLE IF NOT EXISTS progress (
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  chapter integer NOT NULL CHECK (chapter > 0),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, group_id)
);
