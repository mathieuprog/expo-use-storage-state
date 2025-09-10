// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const externalPeers = [
  'react',
  'react-native',
  'expo-secure-store',
  '@react-native-async-storage/async-storage',
];

export default [
  // 1) bundle the JS
  {
    input: 'src/index.ts',
    external: externalPeers,
    output: [
      { file: 'dist/index.cjs', format: 'cjs', exports: 'named' },
      { file: 'dist/index.js', format: 'esm' },
    ],
    plugins: [
      resolve({ extensions: ['.js', '.ts'] }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' }),
    ],
  },

  // 2) emit the types
  {
    input: 'dist/index.d.ts',
    external: externalPeers,
    output: [{ file: 'dist/index.d.ts', format: 'esm' }],
    plugins: [dts()],
  },
];
