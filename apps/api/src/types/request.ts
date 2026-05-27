import type { Request } from 'express';
import type { Project } from '../db/schema';

export interface AuthedRequest extends Request {
  project: Project;
}
