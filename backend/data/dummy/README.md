Dummy data files used by `POST /admin/seed-dummy-data`.

Files:
- `teachers.csv`: teacher credentials
- `teacher_assignments.csv`: teacher to class-section mapping
- `students.csv`: student users with class/section and roll numbers
- `google_sheets_configs.csv`: per-teacher class sheet mappings
- `class_sections.csv`: class section master data
- `subjects.csv`: subject catalog per class-section (theory/practical and max marks)
- `subject_assignments.csv`: teacher to subject mapping per class-section
- `sample_sheet_template.csv`: expected CSV format for Google Sheet sync

Google Sheet sync expected columns:
- `student_id`
- `status` (`Present` or `Absent`)
- `marks` (0-100)
- `assignment_score` (0-100)
- `co_curricular_score` (0-100)

Prediction-ready seed behavior:
- Creates/upserts MCA(A/B) teachers, students, class-sections, subjects and subject-teacher mapping.
- Generates 36 recent academic days of attendance per class-section.
- Generates historical performance records per student/day with realistic variation:
  - high-performing, good, average, improving, and at-risk student patterns
  - attendance variability and assignment-missing behavior for risk modeling
- Designed to improve rule-based risk scoring and future ML model training/testing.
