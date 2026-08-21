import { setText } from '../../../core/dom';

export function setCallStatus(status: string): void {
  setText('call-status', status);
}
