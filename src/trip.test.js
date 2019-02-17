/**
 * @file Test the trip library initialization.
 */

const trip = require('./trip.js');


beforeAll(() => {
  let tripPromise = tripFactory.instantiate();
  tripPromise.then((tripLocal) => {
    trip = tripLocal;
  });
  return tripPromise;
});

describe('trip', () => {
  test('is instantiated', () => {
    expect(trip).toBeTruthy();
  });
});


