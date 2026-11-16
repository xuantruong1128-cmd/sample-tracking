try {
  console.log(require.resolve('pg'));
} catch (e) {
  console.log('Not installed');
}
