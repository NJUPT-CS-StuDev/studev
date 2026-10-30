import type { Exam, ExamChange, ExamSource } from '../facts';

/** exams/<term>/index.json */
export interface ExamIndexFile { classes: string[]; sources: ExamSource[] }
/** exams/<term>/classes/<class>.json */
export interface ExamClassFile { exams: Exam[]; changes: ExamChange[] }
