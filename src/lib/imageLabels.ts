import ImageLabeling from '@react-native-ml-kit/image-labeling';
import { AnimalVerdict, Label, verdictFor } from './animalCheck';

/**
 * The bridge to ML Kit's on-device image labeller.
 *
 * Split from animalCheck.ts so the scoring stays importable by plain node for
 * its self-check — the same reason `directionsUrl` takes a platform argument
 * instead of reading `Platform.OS`.
 *
 * The model ships inside the app (`com.google.mlkit:image-labeling`), so this
 * runs offline, costs nothing per call, and sends no photo anywhere. That last
 * part matters: the alternative designs all involve uploading the image to a
 * third party before the user has agreed to publish it.
 */

/**
 * Labels a local image file. Returns a verdict, never throws.
 *
 * Failure is treated as "ask the user", not as "reject": if the native module
 * is missing (a JS-only reload, a build without the pod), or ML Kit chokes on
 * the file, we must not silently drop a real sighting — and we equally must not
 * let a classifier outage become a hard gate on the app's core action.
 */
export async function classifyPhoto(uri: string): Promise<AnimalVerdict> {
  try {
    const labels = (await ImageLabeling.label(uri)) as Label[];

    if (__DEV__) {
      // The label strings in animalCheck.ts are taken from Google's published
      // label map and are worth confirming against real photos. This is how:
      // shoot a few strays, read the console, tune the sets.
      console.log(
        '[animalCheck] labels:',
        (labels ?? []).map(l => `${l.text} ${l.confidence.toFixed(2)}`).join(', ') || '(none)',
      );
    }

    return verdictFor(labels);
  } catch (err) {
    if (__DEV__) console.warn('[animalCheck] labelling failed:', err);
    // Uncertain rather than confident: the user gets one tap to confirm, which
    // is the honest outcome when we genuinely do not know.
    return { decision: 'uncertain', species: null, topLabel: null, confidence: 0 };
  }
}
