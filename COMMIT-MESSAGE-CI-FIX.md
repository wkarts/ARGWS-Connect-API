fix(ci): correct API group typing and Manager image build

- type Baileys participating groups as GroupMetadata[]
- remove unknown property access in fetchAllGroups
- build Manager dist inside a Node 22 Docker builder stage
- stop depending on dist excluded by manager/.dockerignore
- keep Nginx runtime config entrypoint in the final Manager image
- validate Manager source, build, smoke and runtime configuration

Fixes failures observed in GitHub Actions run 92297357423 on amd64 and arm64.
