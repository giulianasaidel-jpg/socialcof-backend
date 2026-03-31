import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Returns an Express middleware that validates req.body against the given Zod schema.
 * Responds with 400 and structured errors if validation fails.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ message: 'Validation error', errors: result.error.flatten().fieldErrors });
      return;
    }
    req.body = result.data;
    next();
  };
}
