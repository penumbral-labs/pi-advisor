export const Type = {
	Literal: (value) => ({ const: value }),
	Object: (properties) => ({ properties, type: "object" }),
	Optional: (value) => value,
	Union: (values) => ({ anyOf: values }),
};
