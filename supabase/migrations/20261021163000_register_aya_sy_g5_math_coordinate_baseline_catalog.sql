-- Family Learning Hub: data-only, forward-only catalog association for Aya's
-- Syrian G5 coordinate-grid baseline. Preserve existing draft/version and attempts.
DO $flh$
DECLARE
  v_workspace uuid;
  v_program uuid;
  v_quiz uuid;
  v_subject uuid;
  v_version uuid;
BEGIN
  SELECT p.workspace_id, p.id INTO STRICT v_workspace, v_program
  FROM public.learning_programs p
  WHERE p.code = 'SY-G5-2025-2026' AND p.status = 'active'
    AND p.grade_level = 5;

  -- Rebuilt/isolated databases do not contain the October 6 live draft.
  -- Make fresh installs a no-op; when that draft exists, enforce all guards.
  SELECT q.id INTO v_quiz
  FROM public.quizzes q
  JOIN public.learning_programs p ON p.id = v_program
   AND p.workspace_id = q.workspace_id AND p.curriculum_id = q.curriculum_id
  JOIN public.books b ON b.id = q.book_id
  WHERE q.slug = 'sy-g5-math-coordinate-grid-baseline-20261006-a'
    AND q.status = 'draft' AND q.subject_id = 1
    AND b.code = 'AR-MATH-G5-2025-2026' AND q.workspace_id = v_workspace;

  IF v_quiz IS NULL THEN RETURN; END IF;

  SELECT v.id INTO STRICT v_version
  FROM public.quiz_versions v
  WHERE v.quiz_id = v_quiz AND v.workspace_id = v_workspace
    AND v.state = 'draft';

  IF EXISTS (SELECT 1 FROM public.quiz_questions WHERE quiz_version_id = v_version)
    OR EXISTS (SELECT 1 FROM public.quiz_attempts WHERE quiz_version_id = v_version)
    OR EXISTS (SELECT 1 FROM public.quiz_assignments WHERE quiz_version_id = v_version)
    OR EXISTS (SELECT 1 FROM public.assessment_publications WHERE quiz_version_id = v_version)
  THEN RAISE EXCEPTION 'FLH_AYA_BASELINE_NOT_FRESH'; END IF;

  SELECT ps.id INTO STRICT v_subject
  FROM public.program_subjects ps
  JOIN public.program_books pb ON pb.program_id = ps.program_id
   AND pb.program_subject_id = ps.id
  JOIN public.books b ON b.id = pb.book_id
  WHERE ps.workspace_id = v_workspace AND ps.program_id = v_program
    AND ps.subject_id = 1 AND b.code = 'AR-MATH-G5-2025-2026';

  IF EXISTS (SELECT 1 FROM public.program_quizzes pq
             WHERE pq.program_id = v_program AND pq.quiz_id = v_quiz
               AND (pq.availability <> 'available'
                 OR pq.program_subject_id IS DISTINCT FROM v_subject))
  THEN RAISE EXCEPTION 'FLH_AYA_BASELINE_CATALOG_CONFLICT'; END IF;

  INSERT INTO public.program_quizzes
    (workspace_id, program_id, quiz_id, program_subject_id, availability, sort_order, metadata)
  VALUES
    (v_workspace, v_program, v_quiz, v_subject, 'available', 60,
     jsonb_build_object('source','aya_sy_g5_coordinate_baseline_catalog_20261021',
                        'modes',jsonb_build_array('learning','exam'),
                        'phase','baseline_readiness',
                        'book_code','AR-MATH-G5-2025-2026',
                        'source_pdf_pages',jsonb_build_array(3,4,5,6)))
  ON CONFLICT (program_id, quiz_id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.program_quizzes pq
                 WHERE pq.program_id = v_program AND pq.quiz_id = v_quiz
                   AND pq.workspace_id = v_workspace AND pq.program_subject_id = v_subject
                   AND pq.availability = 'available')
  THEN RAISE EXCEPTION 'FLH_AYA_BASELINE_CATALOG_LINK_FAILED'; END IF;
END;
$flh$;
