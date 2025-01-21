# Contributing to GuardDuty Sentinel Integration

We love your input! We want to make contributing to this project as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## Development Process

We use GitHub to host code, to track issues and feature requests, as well as accept pull requests.

## Pull Requests

Pull requests are the best way to propose changes to the codebase. We actively welcome your pull requests:

1. Fork the repo and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. If you've changed APIs, update the documentation.
4. Ensure the test suite passes.
5. Make sure your code lints.
6. Issue that pull request!

## Any contributions you make will be under the MIT Software License

In short, when you submit code changes, your submissions are understood to be under the same [MIT License](http://choosealicense.com/licenses/mit/) that covers the project. Feel free to contact the maintainers if that's a concern.

## Report bugs using GitHub's [issue tracker](https://github.com/olu1406/guardduty-sentinel-integration/issues)

We use GitHub issues to track public bugs. Report a bug by [opening a new issue](https://github.com/olu1406/guardduty-sentinel-integration/issues/new); it's that easy!

## Write bug reports with detail, background, and sample code

**Great Bug Reports** tend to have:

- A quick summary and/or background
- Steps to reproduce
  - Be specific!
  - Give sample code if you can
- What you expected would happen
- What actually happens
- Notes (possibly including why you think this might be happening, or stuff you tried that didn't work)

## Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/olu1406/guardduty-sentinel-integration.git
   cd guardduty-sentinel-integration
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Run tests**:
   ```bash
   npm test
   ```

5. **Start development server**:
   ```bash
   npm run dev
   ```

## Code Style

We use ESLint and Prettier for code formatting. Please ensure your code follows our style guidelines:

```bash
# Check linting
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format
```

## Testing

We maintain high test coverage and use multiple testing strategies:

- **Unit Tests**: Test individual components
- **Integration Tests**: Test component interactions
- **Property-Based Tests**: Test universal properties
- **End-to-End Tests**: Test complete workflows

```bash
# Run all tests
npm test

# Run specific test types
npm run test:unit
npm run test:integration
npm run test:property
npm run test:e2e

# Run with coverage
npm run test:coverage
```

## Documentation

- Update README.md if you change functionality
- Add JSDoc comments for new functions and classes
- Update relevant documentation in the `docs/` directory
- Include examples for new features

## Commit Messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

Examples:
```
feat(azure): add support for managed identity authentication
fix(s3): handle KMS decryption errors gracefully
docs(readme): update deployment instructions
test(batch): add property tests for batch processing
```

## Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create a pull request with the changes
4. After merge, create a GitHub release with tag

## Security

If you discover a security vulnerability, please send an email to security@olu1406.com instead of opening a public issue.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

Feel free to open an issue or reach out to the maintainers if you have any questions about contributing!