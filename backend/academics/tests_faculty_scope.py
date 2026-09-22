from django.test import TestCase
from core.testing import assign, client_for, make_admin, make_faculty, make_subject


class FacultyScopeTests(TestCase):
    def test_only_active_assignments_to_non_archived_subjects(self):
        faculty = make_faculty()
        included = []
        for i, (assignment, status) in enumerate((("active", "active"), ("discontinued", "active"), ("active", "archived"), ("active", "discontinued"))):
            subject = make_subject(code=f"S{i}")
            subject.status = status
            subject.save()
            link = assign(faculty, subject)
            link.status = assignment
            link.save()
            if assignment == "active" and status != "archived":
                included.append(str(subject.pk))
        client = client_for(faculty)
        result = client.get('/api/faculty/subjects/')
        self.assertEqual(result.status_code, 200)
        self.assertCountEqual([s['id'] for s in result.data], included)
        overview = client.get('/api/faculty/analytics/overview/')
        self.assertEqual(overview.status_code, 200)
        self.assertCountEqual([row['subject']['id'] for row in overview.data['subjects']], included)
        for row in result.data:
            self.assertEqual(client.get(f"/api/faculty/subjects/{row['id']}/students/").status_code, 200)
        admin = client_for(make_admin())
        self.assertEqual(len(admin.get('/api/faculty/subjects/').data), 4)
