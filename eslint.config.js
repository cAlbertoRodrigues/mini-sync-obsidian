export default [
  // ...suas configs existentes

  {
    files: ["packages/**/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly"
      }
    }
  }
];
