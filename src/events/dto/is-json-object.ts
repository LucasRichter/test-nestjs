import { registerDecorator, type ValidationOptions } from 'class-validator';

export function IsJsonObject(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isJsonObject',
      target: object.constructor,
      propertyName,
      options: { message: 'data must be a JSON object', ...validationOptions },
      validator: {
        validate(value: unknown) {
          return (
            typeof value === 'object' && value !== null && !Array.isArray(value)
          );
        },
      },
    });
  };
}
