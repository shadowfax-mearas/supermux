-- Managed packages are distinct from the legacy global slash-command registry.
CREATE TABLE skill_packages (
    name TEXT PRIMARY KEY,
    files TEXT NOT NULL,
    description TEXT NOT NULL,
    revision TEXT NOT NULL
);
CREATE TABLE skill_grants (
    skill TEXT NOT NULL REFERENCES skill_packages(name) ON DELETE CASCADE,
    target TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (skill, target)
);
CREATE TABLE skill_launches (
    session TEXT PRIMARY KEY REFERENCES sessions(name) ON UPDATE CASCADE ON DELETE CASCADE,
    snapshot TEXT NOT NULL
);
CREATE TRIGGER skill_grants_session_delete AFTER DELETE ON sessions BEGIN
    DELETE FROM skill_grants WHERE target = OLD.name;
END;
CREATE TRIGGER skill_grants_session_rename AFTER UPDATE OF name ON sessions BEGIN
    UPDATE skill_grants SET target = NEW.name WHERE target = OLD.name;
END;
CREATE TRIGGER skill_grants_company_delete AFTER DELETE ON companies BEGIN
    DELETE FROM skill_grants WHERE target = '@company:' || OLD.id;
END;
